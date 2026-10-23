// tests/standStats.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { quantile, spread, summarize } from '../src/stand/stats.ts'

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not ${expected}`)

describe('quantile', () => {
  it('interpolates between the closest values', () => {
    const sorted = [1, 2, 3, 4]
    near(quantile(sorted, 0), 1)
    near(quantile(sorted, 1), 4)
    near(quantile(sorted, 0.5), 2.5)
    near(quantile(sorted, 0.25), 1.75)
  })

  it('keeps p within 0 to 1 and says NaN for nothing', () => {
    near(quantile([5, 6], -1), 5)
    near(quantile([5, 6], 2), 6)
    assert.ok(Number.isNaN(quantile([], 0.5)))
  })
})

describe('summarize', () => {
  it('gives the median and the quartiles of unsorted values', () => {
    const found = summarize([9, 1, 5, 3, 7])
    assert.ok(found)
    assert.equal(found.n, 5)
    assert.equal(found.median, 5)
    assert.equal(found.q1, 3)
    assert.equal(found.q3, 7)
    assert.equal(found.min, 1)
    assert.equal(found.max, 9)
    near(found.mean, 5)
  })

  it('takes the sample standard deviation, and 0 for one value', () => {
    near(summarize([2, 4, 4, 4, 5, 5, 7, 9])?.sd ?? -1, Math.sqrt(32 / 7))
    assert.equal(summarize([3])?.sd, 0)
  })

  it('is not moved by one wild run as the mean is', () => {
    const found = summarize([10, 10.2, 9.9, 10.1, 60])
    assert.ok(found)
    assert.ok(Math.abs(found.median - 10.1) < 1e-9)
    assert.ok(found.mean > 20)
  })

  it('leaves out values that are not numbers, and gives null for none', () => {
    assert.equal(summarize([Number.NaN, Infinity])?.n ?? null, null)
    assert.equal(summarize([1, Number.NaN, 3])?.n, 2)
    assert.equal(summarize([]), null)
  })
})

describe('spread', () => {
  it('is the interquartile range over the median', () => {
    const found = summarize([8, 9, 10, 11, 12])
    assert.ok(found)
    near(spread(found) ?? -1, 0.2)
  })

  it('is null when the median is 0', () => {
    const found = summarize([0, 0, 0])
    assert.ok(found)
    assert.equal(spread(found), null)
  })
})
