// tests/responsiveness.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summarizeTasks, watchResponsiveness } from '../src/diagnostics/responsiveness.ts'
import type { WatchHost } from '../src/diagnostics/responsiveness.ts'

describe('summarizeTasks', () => {
  it('counts the tasks and finds the longest and the total', () => {
    assert.deepEqual(summarizeTasks([60, 180.4, 75], 42.6), {
      longTasks: 3,
      longestMs: 180,
      totalMs: 315,
      maxGapMs: 43,
    })
  })

  it('has no freezes to report for an empty list', () => {
    assert.deepEqual(summarizeTasks([]), { longTasks: 0, longestMs: 0, totalMs: 0, maxGapMs: null })
  })
})

class FakeObserver {
  static supportedEntryTypes = ['longtask']
  static last: FakeObserver | null = null
  disconnected = false
  pending: { duration: number }[] = []
  private readonly callback: (list: { getEntries(): { duration: number }[] }) => void
  constructor(callback: (list: { getEntries(): { duration: number }[] }) => void) {
    this.callback = callback
    FakeObserver.last = this
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  takeRecords() {
    const taken = this.pending
    this.pending = []
    return taken
  }
  emit(...durations: number[]) {
    this.callback({ getEntries: () => durations.map((duration) => ({ duration })) })
  }
}

// A clock and a timer the test drives by hand.
function clock() {
  let time = 0
  let beat: (() => void) | null = null
  let hidden = false
  const host: WatchHost = {
    now: () => time,
    setInterval: (callback) => {
      beat = callback
      return 1
    },
    clearInterval: () => {
      beat = null
    },
    hidden: () => hidden,
  }
  return {
    host,
    tick(ms: number) {
      time += ms
      beat?.()
    },
    hide(value: boolean) {
      hidden = value
    },
    get running() {
      return beat !== null
    },
  }
}

const withObserver = (host: WatchHost, supported = true): WatchHost => ({
  ...host,
  PerformanceObserver: (supported
    ? FakeObserver
    : class {
        static supportedEntryTypes: string[] = []
      }) as unknown as typeof PerformanceObserver,
})

describe('watchResponsiveness', () => {
  it('collects the long tasks seen while it watched, and those still waiting at the end', () => {
    const c = clock()
    const watch = watchResponsiveness(withObserver(c.host))
    const observer = FakeObserver.last as FakeObserver
    observer.emit(80, 120)
    observer.pending = [{ duration: 60 }]
    const stats = watch.stop()
    assert.equal(stats?.longTasks, 3)
    assert.equal(stats?.longestMs, 120)
    assert.equal(stats?.totalMs, 260)
    assert.equal(observer.disconnected, true)
  })

  it('finds the longest stall of the timer', () => {
    const c = clock()
    const watch = watchResponsiveness(withObserver(c.host))
    c.tick(10)
    c.tick(11)
    c.tick(95)
    c.tick(10)
    assert.equal(watch.stop()?.maxGapMs, 95)
    assert.equal(c.running, false)
  })

  it('does not count the slow timers of a hidden tab as stalls', () => {
    const c = clock()
    const watch = watchResponsiveness(withObserver(c.host))
    c.tick(10)
    c.hide(true)
    c.tick(1000)
    c.hide(false)
    c.tick(1000)
    c.tick(12)
    assert.equal(watch.stop()?.maxGapMs, 12)
  })

  it('gives the same answer when asked again', () => {
    const c = clock()
    const watch = watchResponsiveness(withObserver(c.host))
    c.tick(30)
    const first = watch.stop()
    c.tick(500)
    ;(FakeObserver.last as FakeObserver).emit(500)
    assert.deepEqual(watch.stop(), first)
  })

  it('measures with the timer alone where there are no long tasks', () => {
    const c = clock()
    const watch = watchResponsiveness(withObserver(c.host, false))
    c.tick(25)
    assert.deepEqual(watch.stop(), { longTasks: 0, longestMs: 0, totalMs: 0, maxGapMs: 25 })
  })

  it('reports nothing where the browser can tell nothing', () => {
    assert.equal(watchResponsiveness({}).stop(), null)
  })
})
