// src/diagnostics/responsiveness.ts

// How the page's own thread fared during an export. longTasks are the tasks of
// more than 50 ms, which a person feels as the page freezing; maxGapMs is the
// longest the page went without answering a timer set for every 10 ms, which
// also shows the smaller stalls.
export interface UiStats {
  longTasks: number
  longestMs: number
  totalMs: number
  maxGapMs: number | null
}

export function summarizeTasks(durations: number[], maxGapMs: number | null = null): UiStats {
  let longest = 0
  let total = 0
  for (const duration of durations) {
    longest = Math.max(longest, duration)
    total += duration
  }
  return {
    longTasks: durations.length,
    longestMs: Math.round(longest),
    totalMs: Math.round(total),
    maxGapMs: maxGapMs === null ? null : Math.round(maxGapMs),
  }
}

export interface Watch {
  // Stops watching and gives what was seen; null where the browser can tell
  // nothing. Calling it again gives the same answer.
  stop(): UiStats | null
}

export interface WatchHost {
  PerformanceObserver?: typeof PerformanceObserver
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (id: unknown) => void
  now?: () => number
  // True while the page is in a hidden tab, where timers are slowed on purpose.
  hidden?: () => boolean
}

const BEAT_MS = 10

function defaultHost(): WatchHost {
  const g = globalThis as unknown as WatchHost & { document?: { hidden: boolean } }
  return {
    PerformanceObserver: g.PerformanceObserver,
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    now: () => performance.now(),
    hidden: () => g.document?.hidden === true,
  }
}

export function watchResponsiveness(host: WatchHost = defaultHost()): Watch {
  const Observer = host.PerformanceObserver
  let observer: PerformanceObserver | null = null
  const durations: number[] = []
  try {
    if (Observer?.supportedEntryTypes?.includes('longtask')) {
      observer = new Observer((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration)
      })
      observer.observe({ type: 'longtask' })
    }
  } catch {
    observer = null
  }

  let maxGap = 0
  let beats = 0
  let timer: unknown = null
  const now = host.now
  if (host.setInterval && now) {
    let last = now()
    let wasHidden = host.hidden?.() ?? false
    timer = host.setInterval(() => {
      const time = now()
      const hidden = host.hidden?.() ?? false
      if (!hidden && !wasHidden) {
        maxGap = Math.max(maxGap, time - last)
        beats++
      }
      wasHidden = hidden
      last = time
    }, BEAT_MS)
  }

  let result: UiStats | null | undefined
  return {
    stop() {
      if (result !== undefined) return result
      if (timer !== null) host.clearInterval?.(timer)
      if (observer) {
        for (const entry of observer.takeRecords()) durations.push(entry.duration)
        observer.disconnect()
      }
      result = !observer && beats === 0 ? null : summarizeTasks(durations, beats > 0 ? maxGap : null)
      return result
    },
  }
}
