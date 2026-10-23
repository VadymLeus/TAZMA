// src/diagnostics/memoryTrace.ts
import { FrameCounter } from './frameCounter.ts'
import type { FrameCounts } from './frameCounter.ts'

// One reading. frames and frameBytes are the highest values seen since the
// previous reading, so a short burst is not lost between two timer ticks.
export interface MemoryPoint {
  // Milliseconds since the export started.
  ms: number
  // Timeline seconds already encoded at that moment.
  time: number
  frames: number
  frameBytes: number
  // Heap of the page's scripts, where the browser tells it.
  heapBytes: number | null
  // With a frame limit: the limit at that moment and the most frames inside
  // the pipeline by the credit count; null without one.
  limit: number | null
  credits: number | null
}

export interface MemoryTrace {
  points: MemoryPoint[]
  peakFrames: number
  peakFrameBytes: number
  peakHeapBytes: number | null
  framesOpened: number
  // Frames that were still open when the export ended.
  framesLeft: number
}

export interface RecorderSources {
  sample: () => FrameCounts
  heap: () => number | null
  now: () => number
  flow?: () => { limit: number; credits: number } | null
}

const MAX_POINTS = 1200

// Keeps readings in a list that never grows past maxPoints: when it does,
// neighbours are merged in pairs keeping the higher value, so peaks survive.
export class MemoryRecorder {
  private points: MemoryPoint[] = []
  private time = 0
  private peakHeap: number | null = null
  private readonly start: number
  private readonly sources: RecorderSources
  private readonly maxPoints: number

  constructor(sources: RecorderSources, maxPoints = MAX_POINTS) {
    this.sources = sources
    this.maxPoints = maxPoints
    this.start = sources.now()
  }

  progress(time: number): void {
    this.time = time
  }

  sample(): void {
    const counts = this.sources.sample()
    const heap = this.sources.heap()
    const flow = this.sources.flow?.() ?? null
    if (heap !== null) this.peakHeap = Math.max(this.peakHeap ?? 0, heap)
    this.points.push({
      ms: Math.round(this.sources.now() - this.start),
      time: this.time,
      frames: counts.windowLive,
      frameBytes: counts.windowBytes,
      heapBytes: heap,
      limit: flow?.limit ?? null,
      credits: flow?.credits ?? null,
    })
    if (this.points.length > this.maxPoints) this.points = mergePairs(this.points)
  }

  finish(): MemoryTrace {
    this.sample()
    const counts = this.sources.sample()
    return {
      points: this.points,
      peakFrames: counts.peakLive,
      peakFrameBytes: counts.peakBytes,
      peakHeapBytes: this.peakHeap,
      framesOpened: counts.opened,
      framesLeft: counts.live,
    }
  }
}

// When the most frames were open for the first time, in milliseconds since the
// start, and the limit in force then (null without one). Null where no reading
// reached the peak, which is the case for a trace without readings.
export function peakMoment(trace: Pick<MemoryTrace, 'points' | 'peakFrames'>): { ms: number; limit: number | null } | null {
  const point = trace.points?.find((item) => item.frames >= trace.peakFrames && trace.peakFrames > 0)
  return point ? { ms: point.ms, limit: point.limit } : null
}

const higher = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

export function mergePairs(points: MemoryPoint[]): MemoryPoint[] {
  const merged: MemoryPoint[] = []
  for (let i = 0; i < points.length; i += 2) {
    const a = points[i] as MemoryPoint
    const b = points[i + 1]
    merged.push(
      b
        ? {
            ms: b.ms,
            time: b.time,
            frames: Math.max(a.frames, b.frames),
            frameBytes: Math.max(a.frameBytes, b.frameBytes),
            heapBytes: higher(a.heapBytes, b.heapBytes),
            limit: b.limit,
            credits: higher(a.credits, b.credits),
          }
        : a,
    )
  }
  return merged
}

export function jsHeapBytes(): number | null {
  const memory = (globalThis.performance as unknown as { memory?: { usedJSHeapSize?: number } })
    ?.memory
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null
}

// Semicolons and whole numbers only, so a spreadsheet in any locale opens it
// in columns.
export function traceToCsv(trace: MemoryTrace): string {
  const rows = ['ms;timeline_ms;frames;frame_bytes;heap_bytes;limit;credits']
  for (const point of trace.points) {
    rows.push(
      [
        point.ms,
        Math.round(point.time * 1000),
        point.frames,
        point.frameBytes,
        point.heapBytes ?? '',
        point.limit === null ? '' : Number.isFinite(point.limit) ? point.limit : '',
        point.credits ?? '',
      ].join(';'),
    )
  }
  return rows.join('\n') + '\n'
}

export interface MemoryRun {
  progress: (time: number) => void
  finish: () => MemoryTrace
  // Stops the timer and puts the browser's classes back.
  dispose: () => void
}

const INTERVAL_MS = 100

// Starts counting frames and reading the heap on a timer. Call dispose() when
// the export ends, however it ends.
export function startMemoryRun(flow?: RecorderSources['flow']): MemoryRun {
  const counter = new FrameCounter()
  counter.install()
  const recorder = new MemoryRecorder({
    sample: () => counter.sample(),
    heap: jsHeapBytes,
    now: () => performance.now(),
    flow,
  })
  const timer = setInterval(() => recorder.sample(), INTERVAL_MS)
  recorder.sample()
  let stopped = false
  const dispose = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    counter.uninstall()
  }
  return {
    progress: (time) => recorder.progress(time),
    finish: () => {
      const trace = recorder.finish()
      dispose()
      return trace
    },
    dispose,
  }
}
