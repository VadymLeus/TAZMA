// tests/limit.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_LIMIT,
  combineLimits,
  fixedBytes,
  frameBytes,
  memoryLimit,
  throughputLimit,
} from '../src/pipeline/limit.ts'

const MIB = 1024 * 1024

describe('frameBytes', () => {
  it('is one and a half bytes a pixel', () => {
    assert.equal(frameBytes(1280, 720), 1_382_400)
    assert.equal(frameBytes(3840, 2160), 12_441_600)
  })
})

describe('fixedBytes', () => {
  it('is two pictures of four bytes a pixel', () => {
    assert.equal(fixedBytes(1280, 720), 7_372_800)
    assert.equal(fixedBytes(3840, 2160), 66_355_200)
  })

  it('reproduces the peak measured on 4K: two encoder pictures and decoder frames', () => {
    const peakMiB = (frames: number) => ((frames - 2) * frameBytes(3840, 2160) + fixedBytes(3840, 2160)) / MIB
    assert.ok(Math.abs(peakMiB(4) - 87.01171875) < 1e-9)
    assert.ok(Math.abs(peakMiB(10) - 158.203125) < 1e-9)
  })
})

describe('memoryLimit', () => {
  it('counts the frames that fit the budget after the encoder pictures', () => {
    assert.equal(memoryLimit(256 * MIB, 1280, 720), 188)
    assert.equal(memoryLimit(256 * MIB, 3840, 2160), 16)
    assert.equal(memoryLimit(128 * MIB, 3840, 2160), 5)
  })

  it('counts exactly at the edge of a whole number of frames', () => {
    const budget = fixedBytes(3840, 2160) + 5 * frameBytes(3840, 2160)
    assert.equal(memoryLimit(budget, 3840, 2160), 5)
    assert.equal(memoryLimit(budget - 1, 3840, 2160), 4)
  })

  it('keeps one frame even when the budget is too small for it', () => {
    assert.equal(memoryLimit(MIB, 3840, 2160), 1)
  })

  it('keeps one frame when the budget does not cover the encoder pictures', () => {
    assert.equal(memoryLimit(64 * MIB, 3840, 2160), 1)
    assert.equal(memoryLimit(fixedBytes(3840, 2160), 3840, 2160), 1)
  })

  it('falls back to one frame for nonsense input', () => {
    assert.equal(memoryLimit(0, 1280, 720), 1)
    assert.equal(memoryLimit(-5, 1280, 720), 1)
    assert.equal(memoryLimit(256 * MIB, 0, 720), 1)
    assert.equal(memoryLimit(Number.NaN, 1280, 720), 1)
  })
})

describe('throughputLimit', () => {
  it('is rate times latency with a reserve, rounded up', () => {
    assert.equal(throughputLimit(100, 0.04, 0), 4)
    assert.equal(throughputLimit(100, 0.04, 0.25), 5)
    assert.equal(throughputLimit(120, 0.05, 0.25), 8)
  })

  it('is one frame where nothing is known', () => {
    assert.equal(throughputLimit(0, 0.04, 0.25), 1)
    assert.equal(throughputLimit(100, 0, 0.25), 1)
    assert.equal(throughputLimit(Number.NaN, 0.04, 0.25), 1)
  })

  it('ignores a negative reserve', () => {
    assert.equal(throughputLimit(100, 0.04, -1), 4)
  })
})

describe('combineLimits', () => {
  it('takes the smaller of the two', () => {
    assert.equal(combineLimits(194, 6), 6)
    assert.equal(combineLimits(3, 40), 3)
  })

  it('stays within the bounds', () => {
    assert.equal(combineLimits(0, 0), 1)
    assert.equal(combineLimits(10_000, 10_000), MAX_LIMIT)
  })
})
