// tests/gifTiming.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { frameMicro, gifTimeline, isGif } from '../src/gif/timing.ts'

describe('frameMicro', () => {
  it('keeps a normal delay and rounds it to whole microseconds', () => {
    assert.equal(frameMicro(40_000), 40_000)
    assert.equal(frameMicro(33_333.4), 33_333)
    assert.equal(frameMicro(20_000), 20_000)
  })

  it('shows very short and missing delays for 0.1 s like browsers do', () => {
    for (const delay of [0, 5_000, 10_000, null, undefined, NaN, -3]) {
      assert.equal(frameMicro(delay), 100_000)
    }
  })

  it('gives a picture with one frame a few seconds', () => {
    assert.equal(frameMicro(0, true), 3_000_000)
    assert.equal(frameMicro(5_000_000, true), 5_000_000)
  })
})

describe('gifTimeline', () => {
  it('adds the delays up', () => {
    const times = gifTimeline([50_000, 100_000, 20_000, 10_000])
    assert.deepEqual(
      times.map((time) => [time.start, time.duration]),
      [[0, 0.05], [0.05, 0.1], [0.15, 0.02], [0.17, 0.1]],
    )
  })

  it('does not drift over a long file', () => {
    const times = gifTimeline(Array.from({ length: 3000 }, () => 33_333))
    const last = times[times.length - 1]!
    assert.equal(Math.round((last.start + last.duration) * 1e6), 3000 * 33_333)
  })

  it('makes a picture of a single frame', () => {
    assert.deepEqual(gifTimeline([0]), [{ start: 0, duration: 3 }])
    assert.deepEqual(gifTimeline([]), [])
  })
})

describe('isGif', () => {
  it('goes by type or by extension', () => {
    assert.equal(isGif({ name: 'a.bin', type: 'image/gif' }), true)
    assert.equal(isGif({ name: 'a.GIF', type: '' }), true)
    assert.equal(isGif({ name: 'a.mp4', type: 'video/mp4' }), false)
    assert.equal(isGif({ name: 'gif.mp4', type: '' }), false)
  })
})
