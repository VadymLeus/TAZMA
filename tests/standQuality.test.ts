// tests/standQuality.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PSNR_CAP, compareFrames, lumaOf, psnr, sampleTimes, ssim, summarizeQuality } from '../src/stand/quality.ts'

const plane = (width: number, height: number, value: (x: number, y: number) => number) =>
  Uint8Array.from({ length: width * height }, (_, i) => value(i % width, Math.floor(i / width)))

const rgba = (pixels: number[][]) => Uint8ClampedArray.from(pixels.flat())

describe('lumaOf', () => {
  it('weighs the channels and keeps white and black', () => {
    const luma = lumaOf(rgba([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255]]))
    assert.deepEqual([...luma], [77, 149, 29, 255, 0])
  })

  it('refuses bytes that are not whole pixels', () => {
    assert.throws(() => lumaOf([1, 2, 3]), RangeError)
  })
})

describe('psnr', () => {
  it('is capped for identical pictures', () => {
    const a = plane(16, 16, (x, y) => x * y)
    assert.equal(psnr(a, a), PSNR_CAP)
  })

  it('follows the mean square error', () => {
    const a = plane(8, 8, () => 100)
    const b = plane(8, 8, () => 110)
    assert.ok(Math.abs(psnr(a, b) - 10 * Math.log10(65025 / 100)) < 1e-9)
  })

  it('falls as the error grows', () => {
    const a = plane(8, 8, () => 100)
    assert.ok(psnr(a, plane(8, 8, () => 105)) > psnr(a, plane(8, 8, () => 120)))
  })

  it('refuses pictures of different sizes', () => {
    assert.throws(() => psnr(new Uint8Array(4), new Uint8Array(5)), RangeError)
    assert.throws(() => psnr(new Uint8Array(0), new Uint8Array(0)), RangeError)
  })
})

describe('ssim', () => {
  const noise = (seed: number, amount: number) => {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return ((state / 0x7fffffff) * 2 - 1) * amount
    }
  }

  it('is 1 for identical pictures', () => {
    const a = plane(32, 24, (x, y) => (x * 7 + y * 3) % 256)
    assert.ok(Math.abs(ssim(a, a, 32, 24) - 1) < 1e-12)
  })

  it('falls with the amount of noise', () => {
    const base = plane(32, 32, (x, y) => (x * 6 + y * 4) % 200 + 20)
    const small = noise(1, 4)
    const large = noise(1, 40)
    const near = Uint8Array.from(base, (v) => Math.max(0, Math.min(255, v + small())))
    const far = Uint8Array.from(base, (v) => Math.max(0, Math.min(255, v + large())))
    const high = ssim(base, near, 32, 32)
    const low = ssim(base, far, 32, 32)
    assert.ok(high > low, `${high} against ${low}`)
    assert.ok(high < 1 && low > -1)
  })

  it('is near 1 for a small shift of a flat picture', () => {
    const value = ssim(plane(16, 16, () => 100), plane(16, 16, () => 104), 16, 16)
    assert.ok(value > 0.99 && value < 1)
  })

  it('treats a picture smaller than a window as one window', () => {
    const a = plane(4, 4, (x) => x * 30)
    assert.ok(Math.abs(ssim(a, a, 4, 4) - 1) < 1e-12)
  })

  it('refuses a size that does not fit the pixels', () => {
    assert.throws(() => ssim(new Uint8Array(10), new Uint8Array(10), 4, 4), RangeError)
  })
})

describe('compareFrames and summarizeQuality', () => {
  it('compares RGBA pictures by brightness', () => {
    const a = rgba([[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255], [100, 110, 120, 255]])
    const same = compareFrames(a, a, 2, 2)
    assert.equal(same.psnr, PSNR_CAP)
    assert.equal(same.ssim, 1)
  })

  it('counts identical frames apart and averages the rest', () => {
    const report = summarizeQuality([
      { psnr: PSNR_CAP, ssim: 1 },
      { psnr: 40, ssim: 0.98 },
      { psnr: 30, ssim: 0.9 },
    ])
    assert.ok(report)
    assert.equal(report.frames, 3)
    assert.equal(report.identical, 1)
    assert.equal(report.psnrMean, 35)
    assert.equal(report.psnrMin, 30)
    assert.ok(Math.abs(report.ssimMean - (1 + 0.98 + 0.9) / 3) < 1e-12)
    assert.equal(report.ssimMin, 0.9)
  })

  it('has no PSNR mean when every frame is identical, and no report without frames', () => {
    assert.equal(summarizeQuality([{ psnr: PSNR_CAP, ssim: 1 }])?.psnrMean, null)
    assert.equal(summarizeQuality([]), null)
  })
})

describe('sampleTimes', () => {
  it('spreads the times over the timeline at frame middles', () => {
    const times = sampleTimes(10, 5, 30)
    assert.equal(times.length, 5)
    assert.ok(times.every((t) => t > 0 && t < 10))
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1])
    for (const t of times) assert.ok(Math.abs(t * 30 - Math.floor(t * 30) - 0.5) < 1e-9)
  })

  it('does not repeat a frame when there are fewer frames than samples', () => {
    assert.equal(sampleTimes(0.1, 10, 30).length, 3)
  })

  it('gives nothing for nothing to sample', () => {
    assert.deepEqual(sampleTimes(0, 5, 30), [])
    assert.deepEqual(sampleTimes(5, 0, 30), [])
  })
})
