// tests/memoryTrace.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FrameCounter } from '../src/diagnostics/frameCounter.ts'
import { MemoryRecorder, mergePairs, traceToCsv } from '../src/diagnostics/memoryTrace.ts'
import type { MemoryPoint } from '../src/diagnostics/memoryTrace.ts'

function setup(maxPoints?: number) {
  const counter = new FrameCounter()
  let clock = 1000
  let heap: number | null = 5_000_000
  const recorder = new MemoryRecorder(
    { sample: () => counter.sample(), heap: () => heap, now: () => clock },
    maxPoints,
  )
  return {
    counter,
    recorder,
    tick: (ms: number) => {
      clock += ms
    },
    setHeap: (value: number | null) => {
      heap = value
    },
  }
}

const frame = () => ({ codedWidth: 10, codedHeight: 10, close() {} })

describe('MemoryRecorder', () => {
  it('records time since the start, progress, frames and heap', () => {
    const { counter, recorder, tick } = setup()
    tick(100)
    recorder.progress(2.5)
    const a = counter.track(frame())
    const b = counter.track(frame())
    recorder.sample()
    a.close()
    b.close()
    const trace = recorder.finish()
    const [first] = trace.points
    assert.deepEqual(first, {
      ms: 100,
      time: 2.5,
      frames: 2,
      frameBytes: 300,
      heapBytes: 5_000_000,
      limit: null,
      credits: null,
    })
    assert.equal(trace.peakFrames, 2)
    assert.equal(trace.peakFrameBytes, 300)
    assert.equal(trace.peakHeapBytes, 5_000_000)
    assert.equal(trace.framesOpened, 2)
    assert.equal(trace.framesLeft, 0)
  })

  it('reports frames that were never closed', () => {
    const { counter, recorder } = setup()
    counter.track(frame())
    assert.equal(recorder.finish().framesLeft, 1)
  })

  it('has no heap peak where the browser gives no heap size', () => {
    const { recorder, setHeap } = setup()
    setHeap(null)
    recorder.sample()
    const trace = recorder.finish()
    assert.equal(trace.peakHeapBytes, null)
    assert.ok(trace.points.every((p) => p.heapBytes === null))
  })

  it('follows the heap peak', () => {
    const { recorder, setHeap } = setup()
    setHeap(1)
    recorder.sample()
    setHeap(9)
    recorder.sample()
    setHeap(3)
    assert.equal(recorder.finish().peakHeapBytes, 9)
  })

  it('keeps the number of points bounded and keeps the peaks', () => {
    const { counter, recorder, tick } = setup(50)
    for (let i = 0; i < 500; i++) {
      tick(10)
      const f = counter.track(frame())
      if (i === 123) for (let k = 0; k < 6; k++) counter.track(frame())
      recorder.sample()
      f.close()
    }
    const trace = recorder.finish()
    assert.ok(trace.points.length <= 50)
    assert.ok(trace.points.some((p) => p.frames >= 7))
    const times = trace.points.map((p) => p.ms)
    assert.deepEqual(times, [...times].sort((x, y) => x - y))
  })
})

describe('mergePairs', () => {
  const point = (ms: number, frames: number, heap: number | null): MemoryPoint => ({
    ms,
    time: ms / 1000,
    frames,
    frameBytes: frames * 10,
    heapBytes: heap,
    limit: null,
    credits: null,
  })

  it('merges neighbours into the later time and the higher values', () => {
    const merged = mergePairs([point(1, 2, 5), point(2, 7, 3), point(3, 1, null), point(4, 1, 4)])
    assert.deepEqual(merged, [point(2, 7, 5), point(4, 1, 4)])
  })

  it('keeps a last odd point as it is', () => {
    const merged = mergePairs([point(1, 1, null), point(2, 2, null), point(3, 3, null)])
    assert.equal(merged.length, 2)
    assert.deepEqual(merged[1], point(3, 3, null))
  })
})

describe('traceToCsv', () => {
  it('writes a header and a row of whole numbers per point', () => {
    const csv = traceToCsv({
      points: [
        { ms: 100, time: 1.25, frames: 3, frameBytes: 450, heapBytes: 2048, limit: 4, credits: 3 },
        { ms: 200, time: 2, frames: 4, frameBytes: 600, heapBytes: null, limit: null, credits: null },
      ],
      peakFrames: 4,
      peakFrameBytes: 600,
      peakHeapBytes: 2048,
      framesOpened: 9,
      framesLeft: 0,
    })
    assert.equal(
      csv,
      'ms;timeline_ms;frames;frame_bytes;heap_bytes;limit;credits\n100;1250;3;450;2048;4;3\n200;2000;4;600;;;\n',
    )
  })
})

describe('MemoryRecorder with a frame limit', () => {
  it('records the limit and the credits of the pipeline with every reading', () => {
    const counter = new FrameCounter()
    let clock = 0
    let flow = { limit: 1, credits: 1 }
    const recorder = new MemoryRecorder({
      sample: () => counter.sample(),
      heap: () => null,
      now: () => clock,
      flow: () => flow,
    })
    clock += 100
    recorder.sample()
    flow = { limit: 6, credits: 5 }
    clock += 100
    recorder.sample()
    const { points } = recorder.finish()
    assert.deepEqual(
      points.map((p) => [p.limit, p.credits]),
      [
        [1, 1],
        [6, 5],
        [6, 5],
      ],
    )
  })

  it('writes the limit and the credits into the csv, empty where there are none', () => {
    const csv = traceToCsv({
      points: [
        { ms: 1, time: 0, frames: 1, frameBytes: 1, heapBytes: null, limit: Infinity, credits: 2 },
      ],
      peakFrames: 1,
      peakFrameBytes: 1,
      peakHeapBytes: null,
      framesOpened: 1,
      framesLeft: 0,
    })
    assert.equal(csv.split('\n')[1], '1;0;1;1;;;2')
  })
})
