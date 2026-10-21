// tests/frameCounter.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FrameCounter } from '../src/diagnostics/frameCounter.ts'
import type { FrameHost } from '../src/diagnostics/frameCounter.ts'

class FakeFrame {
  closed = 0
  codedWidth: number
  codedHeight: number
  constructor(codedWidth = 4, codedHeight = 2) {
    this.codedWidth = codedWidth
    this.codedHeight = codedHeight
  }
  allocationSize() {
    return this.codedWidth * this.codedHeight * 1.5
  }
  clone() {
    return new FakeFrame(this.codedWidth, this.codedHeight)
  }
  close() {
    this.closed++
  }
}

class FakeDecoder {
  static kind = 'decoder'
  init: { output: (frame: FakeFrame) => void }
  constructor(init: { output: (frame: FakeFrame) => void }) {
    this.init = init
  }
  emit(frame: FakeFrame) {
    this.init.output(frame)
  }
}

describe('FrameCounter', () => {
  it('counts open frames and the memory they hold', () => {
    const counter = new FrameCounter()
    const a = counter.track(new FakeFrame(10, 10))
    const b = counter.track(new FakeFrame(10, 10))
    assert.equal(counter.counts().live, 2)
    assert.equal(counter.counts().liveBytes, 300)
    a.close()
    assert.equal(counter.counts().live, 1)
    assert.equal(counter.counts().liveBytes, 150)
    b.close()
    assert.equal(counter.counts().live, 0)
    assert.equal(counter.counts().liveBytes, 0)
    assert.equal(counter.counts().peakLive, 2)
    assert.equal(counter.counts().peakBytes, 300)
    assert.equal(counter.counts().opened, 2)
  })

  it('still closes the frame it wraps, and only counts a close once', () => {
    const counter = new FrameCounter()
    const frame = counter.track(new FakeFrame())
    frame.close()
    frame.close()
    assert.equal(frame.closed, 2)
    assert.equal(counter.counts().live, 0)
  })

  it('does not count the same frame twice', () => {
    const counter = new FrameCounter()
    const frame = new FakeFrame()
    counter.track(frame)
    counter.track(frame)
    assert.equal(counter.counts().live, 1)
    assert.equal(counter.counts().opened, 1)
  })

  it('estimates the size from the frame width and height without allocationSize', () => {
    const counter = new FrameCounter()
    const frame = { codedWidth: 8, codedHeight: 4, close() {} }
    counter.track(frame)
    assert.equal(counter.counts().liveBytes, 48)
    const broken = {
      codedWidth: 2,
      codedHeight: 2,
      allocationSize() {
        throw new Error('no format')
      },
      close() {},
    }
    counter.track(broken)
    assert.equal(counter.counts().liveBytes, 54)
  })

  it('reports the highest value of each window, so a short burst is not lost', () => {
    const counter = new FrameCounter()
    const first = counter.sample()
    assert.equal(first.windowLive, 0)
    const frames = [1, 2, 3].map(() => counter.track(new FakeFrame()))
    for (const frame of frames) frame.close()
    const second = counter.sample()
    assert.equal(second.live, 0)
    assert.equal(second.windowLive, 3)
    const third = counter.sample()
    assert.equal(third.windowLive, 0)
  })

  it('starts a window from the frames that are still open', () => {
    const counter = new FrameCounter()
    counter.track(new FakeFrame())
    counter.sample()
    assert.equal(counter.sample().windowLive, 1)
  })

  describe('install', () => {
    function host(): FrameHost & Record<string, unknown> {
      return { VideoDecoder: FakeDecoder as never, VideoFrame: FakeFrame as never }
    }

    it('counts what the decoder outputs', () => {
      const counter = new FrameCounter()
      const h = host()
      counter.install(h)
      const seen: FakeFrame[] = []
      const decoder = new (h.VideoDecoder as never as typeof FakeDecoder)({
        output: (frame) => seen.push(frame),
      })
      decoder.emit(new FakeFrame(10, 10))
      decoder.emit(new FakeFrame(10, 10))
      assert.equal(seen.length, 2)
      assert.equal(counter.counts().live, 2)
      seen[0]?.close()
      assert.equal(counter.counts().live, 1)
      counter.uninstall()
    })

    it('counts frames made with the constructor and by clone()', () => {
      const counter = new FrameCounter()
      const h = host()
      counter.install(h)
      const Frame = h.VideoFrame as never as typeof FakeFrame
      const frame = new Frame(10, 10)
      assert.equal(counter.counts().live, 1)
      const copy = frame.clone()
      assert.equal(counter.counts().live, 2)
      copy.close()
      frame.close()
      assert.equal(counter.counts().live, 0)
      counter.uninstall()
    })

    it('keeps instanceof working for frames of the original class', () => {
      const counter = new FrameCounter()
      const h = host()
      counter.install(h)
      assert.ok(new FakeFrame() instanceof (h.VideoFrame as never as typeof FakeFrame))
      assert.ok(!({} instanceof (h.VideoFrame as never as typeof FakeFrame)))
      counter.uninstall()
    })

    it('inherits static members of the classes it replaces', () => {
      const counter = new FrameCounter()
      const h = host()
      counter.install(h)
      assert.equal((h.VideoDecoder as never as typeof FakeDecoder).kind, 'decoder')
      counter.uninstall()
    })

    it('puts the original classes back and can be installed again', () => {
      const counter = new FrameCounter()
      const h = host()
      counter.install(h)
      counter.install(h)
      assert.ok(counter.installed)
      assert.notEqual(h.VideoDecoder, FakeDecoder)
      counter.uninstall()
      assert.ok(!counter.installed)
      assert.equal(h.VideoDecoder, FakeDecoder)
      assert.equal(h.VideoFrame, FakeFrame)
      counter.install(h)
      assert.notEqual(h.VideoFrame, FakeFrame)
      counter.uninstall()
      assert.equal(h.VideoFrame, FakeFrame)
    })

    it('works on a host that has neither class', () => {
      const counter = new FrameCounter()
      const h: FrameHost = {}
      counter.install(h)
      counter.uninstall()
      assert.equal(h.VideoDecoder, undefined)
    })
  })
})
