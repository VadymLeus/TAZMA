// tests/flowControl.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FlowControl } from '../src/pipeline/flowControl.ts'
import type { FlowClock, FlowConfig } from '../src/pipeline/flowControl.ts'

class FakeFrame {
  closed = 0
  codedWidth = 4
  codedHeight = 2
  close() {
    this.closed++
  }
}

// A decoder that keeps `reorder` packets back until it has more, and gives
// frames out only when the test says so.
class FakeDecoder {
  static reorder = 0
  static made: FakeDecoder[] = []
  inbox: unknown[] = []
  outputs = 0
  flushed = 0
  closed = false
  skip = 0
  private readonly output: (frame: FakeFrame) => void
  private readonly onError: ((error: unknown) => void) | undefined
  constructor(init: { output: (frame: FakeFrame) => void; error?: (error: unknown) => void }) {
    this.output = init.output
    this.onError = init.error
    FakeDecoder.made.push(this)
  }
  configure(_config: unknown) {}
  fail(error: unknown) {
    this.onError?.(error)
  }
  get decodeQueueSize() {
    return this.inbox.length
  }
  decode(chunk: unknown) {
    this.inbox.push(chunk)
  }
  // Gives out up to `count` frames, as far as the reorder depth allows.
  produce(count: number): FakeFrame[] {
    const frames: FakeFrame[] = []
    while (frames.length < count && this.inbox.length > FakeDecoder.reorder) {
      this.inbox.shift()
      const frame = new FakeFrame()
      frames.push(frame)
      this.outputs++
      this.output(frame)
    }
    return frames
  }
  async flush() {
    this.flushed++
    while (this.inbox.length > 0) {
      const chunk = this.inbox.shift()
      if (this.skip > 0) {
        this.skip--
        continue
      }
      void chunk
      this.outputs++
      this.output(new FakeFrame())
    }
  }
  reset() {
    this.inbox.length = 0
  }
  close() {
    this.closed = true
  }
}

class ManualClock implements FlowClock {
  time = 0
  private timers: { callback: () => void; ms: number; next: number }[] = []
  now() {
    return this.time
  }
  every(callback: () => void, ms: number) {
    const timer = { callback, ms, next: this.time + ms }
    this.timers.push(timer)
    return () => {
      this.timers = this.timers.filter((entry) => entry !== timer)
    }
  }
  advance(ms: number) {
    const end = this.time + ms
    while (true) {
      const due = this.timers.filter((entry) => entry.next <= end)
      if (due.length === 0) break
      const timer = due.reduce((a, b) => (a.next <= b.next ? a : b))
      this.time = timer.next
      timer.next += timer.ms
      timer.callback()
    }
    this.time = end
  }
  get active() {
    return this.timers.length
  }
}

const config = (limit: number): FlowConfig => ({
  mode: 'fixed',
  limit,
  budgetBytes: 256 * 1024 * 1024,
  frameWidth: 1280,
  frameHeight: 720,
})

function setup(limit: number, reorder = 0) {
  FakeDecoder.reorder = reorder
  FakeDecoder.made = []
  const clock = new ManualClock()
  const flow = new FlowControl(config(limit), clock)
  const host = { VideoDecoder: FakeDecoder as unknown as new (...args: any[]) => any }
  flow.install(host)
  const decoder = new host.VideoDecoder({ output: () => {} })
  const real = FakeDecoder.made[0] as FakeDecoder
  return { flow, clock, host, decoder, real }
}

const MAX_BORROWED = 24

const feed = (decoder: { decode(chunk: unknown): void }, count: number) => {
  for (let i = 0; i < count; i++) decoder.decode({ i })
}

describe('decoder gate', () => {
  it('adds the state of the gate to an error of the decoder', () => {
    FakeDecoder.reorder = 0
    FakeDecoder.made = []
    const flow = new FlowControl(config(2), new ManualClock())
    const host = { VideoDecoder: FakeDecoder as unknown as new (...args: any[]) => any }
    flow.install(host)
    const seen: unknown[] = []
    const decoder = new host.VideoDecoder({ output: () => {}, error: (error: unknown) => seen.push(error) })
    feed(decoder, 5)
    const cause = new Error('Decoding error.')
    cause.name = 'EncodingError'
    ;(FakeDecoder.made[0] as FakeDecoder).fail(cause)
    const error = seen[0] as Error
    assert.equal(error.name, 'EncodingError')
    assert.equal(error.cause, cause)
    assert.match(error.message, /Decoding error\./)
    assert.match(error.message, /чекає 3/)
    assert.match(error.message, /надіслано 2/)
    assert.match(error.message, /ліміт 2/)
    flow.uninstall()
  })

  it('hands on an error that is not an Error as it is', () => {
    FakeDecoder.made = []
    const flow = new FlowControl(config(2), new ManualClock())
    const host = { VideoDecoder: FakeDecoder as unknown as new (...args: any[]) => any }
    flow.install(host)
    const seen: unknown[] = []
    new host.VideoDecoder({ output: () => {}, error: (error: unknown) => seen.push(error) })
    ;(FakeDecoder.made[0] as FakeDecoder).fail('boom')
    assert.deepEqual(seen, ['boom'])
    flow.uninstall()
  })

  it('lets packets into the decoder only while credits last', () => {
    const { flow, decoder, real } = setup(2)
    feed(decoder, 5)
    assert.equal(real.inbox.length, 2)
    assert.equal(flow.pool.inFlight, 2)
    flow.uninstall()
  })

  it('reports the waiting packets in the decode queue size', () => {
    const { flow, decoder } = setup(2)
    feed(decoder, 5)
    assert.equal(decoder.decodeQueueSize, 5)
    flow.uninstall()
  })

  it('sends the next packet when a dropped frame gives its credit back', () => {
    const { flow, decoder, real } = setup(2)
    feed(decoder, 4)
    const [frame] = real.produce(1) as FakeFrame[]
    assert.equal(real.inbox.length, 1)
    ;(frame as FakeFrame).close()
    assert.equal(real.inbox.length, 2)
    assert.equal(flow.pool.inFlight, 2)
    flow.uninstall()
  })

  it('keeps the credit of a frame that goes to the encoder until the packet comes out', () => {
    const { flow, decoder, real } = setup(1)
    feed(decoder, 2)
    const [frame] = real.produce(1) as FakeFrame[]
    flow.handOff()
    ;(frame as FakeFrame).close()
    assert.equal(flow.pool.inFlight, 1)
    assert.equal(real.inbox.length, 0)
    flow.encoded(1)
    assert.equal(real.inbox.length, 1)
    flow.uninstall()
  })

  it('copes with the encoder being heard before the frame is closed', () => {
    const { flow, decoder, real } = setup(1)
    feed(decoder, 2)
    const [frame] = real.produce(1) as FakeFrame[]
    flow.encoded(1)
    assert.equal(real.inbox.length, 0)
    flow.handOff()
    ;(frame as FakeFrame).close()
    assert.equal(flow.pool.inFlight, 1)
    assert.equal(real.inbox.length, 1)
    flow.uninstall()
  })

  it('gives a credit back once, however often a frame is closed', () => {
    const { flow, decoder, real } = setup(2)
    feed(decoder, 2)
    const [frame] = real.produce(1) as FakeFrame[]
    ;(frame as FakeFrame).close()
    ;(frame as FakeFrame).close()
    assert.equal(flow.pool.inFlight, 1)
    flow.uninstall()
  })

  it('finishes a flush only after every waiting packet has gone in', async () => {
    const { flow, decoder, real } = setup(1)
    feed(decoder, 3)
    let done = false
    const flushing = decoder.flush().then(() => {
      done = true
    })
    await Promise.resolve()
    assert.equal(done, false)
    real.produce(1)[0]?.close()
    real.produce(1)[0]?.close()
    await flushing
    assert.equal(done, true)
    assert.equal(real.flushed, 1)
    flow.uninstall()
  })

  it('takes back the credits of packets that produced no frame', async () => {
    const { flow, decoder, real } = setup(4)
    feed(decoder, 3)
    real.skip = 1
    await decoder.flush()
    // One of the three frames never came; its credit is free again, the two
    // frames that did come still hold theirs.
    assert.equal(flow.pool.inFlight, 2)
    flow.uninstall()
  })

  it('gives every credit back when the decoder is closed', () => {
    const { flow, decoder, real } = setup(3)
    feed(decoder, 5)
    real.produce(1)
    decoder.close()
    assert.equal(flow.pool.inFlight, 0)
    assert.equal(real.closed, true)
    flow.uninstall()
  })

  it('does not give credits twice when frames are closed after the decoder', () => {
    const { flow, decoder, real } = setup(3)
    feed(decoder, 3)
    const frames = real.produce(2)
    decoder.close()
    for (const frame of frames) frame.close()
    assert.equal(flow.pool.inFlight, 0)
    flow.uninstall()
  })

  it('settles what the encoder still owes at the end of a session', () => {
    const { flow, decoder, real } = setup(3)
    feed(decoder, 3)
    for (const frame of real.produce(3)) {
      flow.handOff()
      frame.close()
    }
    assert.equal(flow.pool.inFlight, 3)
    flow.settle()
    assert.equal(flow.pool.inFlight, 0)
    flow.uninstall()
  })

  it('puts the class of the browser back', () => {
    const { flow, host } = setup(2)
    assert.notEqual(host.VideoDecoder, FakeDecoder)
    flow.uninstall()
    assert.equal(host.VideoDecoder, FakeDecoder)
  })
})

describe('stalls', () => {
  it('lends a credit when a decoder holds frames back until it sees more packets', () => {
    const { flow, clock, decoder, real } = setup(1, 2)
    feed(decoder, 4)
    assert.equal(real.inbox.length, 1)
    clock.advance(300)
    assert.equal(real.inbox.length, 2)
    clock.advance(300)
    assert.equal(real.inbox.length, 3)
    assert.equal(flow.report().borrowed, 2)
    assert.equal(flow.report().floor, 3)
    flow.uninstall()
  })

  it('remembers the depth that was needed', () => {
    const { flow, clock, host, decoder } = setup(1, 2)
    feed(decoder, 3)
    clock.advance(1000)
    assert.equal(flow.report().floor, 3)
    decoder.close()
    const later = new host.VideoDecoder({ output: () => {} })
    feed(later, 5)
    const second = FakeDecoder.made[1] as FakeDecoder
    assert.equal(second.inbox.length, 3)
    assert.equal(flow.report().borrowed, 2)
    flow.uninstall()
  })

  it('does not lend while frames are coming', () => {
    const { flow, clock, decoder, real } = setup(2)
    feed(decoder, 6)
    for (let i = 0; i < 10; i++) {
      clock.advance(60)
      real.produce(1)[0]?.close()
    }
    assert.equal(flow.report().borrowed, 0)
    flow.uninstall()
  })

  it('lets go of the limit when it keeps needing borrowed credits', () => {
    const { flow, clock, decoder, real } = setup(1, 1000)
    feed(decoder, 60)
    clock.advance(MAX_BORROWED * 300)
    assert.equal(flow.report().released, true)
    assert.equal(real.inbox.length, 60)
    flow.uninstall()
  })

  it('stops watching when nothing waits', () => {
    const { flow, clock, decoder, real } = setup(2)
    feed(decoder, 3)
    assert.equal(clock.active, 1)
    real.produce(1)[0]?.close()
    assert.equal(clock.active, 0)
    void decoder
    flow.uninstall()
  })

  it('measures how long the entrance was shut', () => {
    const { flow, clock, decoder, real } = setup(1)
    feed(decoder, 2)
    clock.advance(40)
    real.produce(1)[0]?.close()
    assert.equal(flow.report().waitedMs, 40)
    flow.uninstall()
  })
})

describe('auto mode', () => {
  it('starts with one frame at a time and reports what it measured', () => {
    FakeDecoder.reorder = 0
    FakeDecoder.made = []
    const clock = new ManualClock()
    const flow = new FlowControl({ ...config(1), mode: 'auto' }, clock)
    const host = { VideoDecoder: FakeDecoder as unknown as new (...args: any[]) => any }
    flow.install(host)
    const decoder = new host.VideoDecoder({ output: () => {} })
    const real = FakeDecoder.made[0] as FakeDecoder
    feed(decoder, 3)
    assert.equal(real.inbox.length, 1)
    let sent = 0
    for (let i = 0; i < 14; i++) {
      clock.advance(30)
      const frames = real.produce(1)
      for (const frame of frames) {
        frame.close()
        sent++
      }
      feed(decoder, 1)
    }
    const report = flow.report()
    assert.equal(report.mode, 'auto')
    assert.ok(sent >= 12)
    assert.notEqual(report.latencyMs, null)
    assert.ok(Math.abs((report.latencyMs as number) - 30) < 1)
    flow.uninstall()
  })
})
