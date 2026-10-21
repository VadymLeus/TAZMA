// tests/limit.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_LIMIT,
  combineLimits,
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

describe('memoryLimit', () => {
  it('counts the frames that fit the budget', () => {
    assert.equal(memoryLimit(256 * MIB, 1280, 720), 194)
    assert.equal(memoryLimit(256 * MIB, 3840, 2160), 21)
  })

  it('keeps one frame even when the budget is too small for it', () => {
    assert.equal(memoryLimit(MIB, 3840, 2160), 1)
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
