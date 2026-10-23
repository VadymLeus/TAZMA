// tests/chartMath.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatAxisSeconds, formatAxisTicks, nearestIndex, niceCeil, tickValues } from '../src/diagnostics/chartMath.ts'

describe('niceCeil', () => {
  it('rounds up to a round step times a power of ten', () => {
    assert.equal(niceCeil(1), 1)
    assert.equal(niceCeil(1.2), 1.5)
    assert.equal(niceCeil(2.2), 3)
    assert.equal(niceCeil(5.1), 6)
    assert.equal(niceCeil(9), 10)
    assert.equal(niceCeil(11), 15)
    assert.equal(niceCeil(26), 30)
    assert.equal(niceCeil(47), 50)
    assert.equal(niceCeil(0.03), 0.03)
    assert.equal(niceCeil(123456), 150000)
  })

  it('gives 1 for zero and for values that are not numbers', () => {
    assert.equal(niceCeil(0), 1)
    assert.equal(niceCeil(-4), 1)
    assert.equal(niceCeil(NaN), 1)
    assert.equal(niceCeil(Infinity), 1)
  })
})

describe('tickValues', () => {
  it('adds the middle when it is a whole number or counts are not whole', () => {
    assert.deepEqual(tickValues(10, true), [0, 5, 10])
    assert.deepEqual(tickValues(1, true), [0, 1])
    assert.deepEqual(tickValues(1, false), [0, 0.5, 1])
  })
})

describe('formatAxisSeconds', () => {
  it('uses seconds, minutes and hours', () => {
    assert.equal(formatAxisSeconds(0), '0,0 с')
    assert.equal(formatAxisSeconds(0.36), '0,4 с')
    assert.equal(formatAxisSeconds(9.94), '9,9 с')
    assert.equal(formatAxisSeconds(44.6), '45 с')
    assert.equal(formatAxisSeconds(120), '2 хв')
    assert.equal(formatAxisSeconds(3900), '65 хв')
    assert.equal(formatAxisSeconds(7200), '2 год')
    assert.equal(formatAxisSeconds(9000), '2 год 30 хв')
  })
})

describe('nearestIndex', () => {
  it('finds the closest x', () => {
    assert.equal(nearestIndex([0, 10, 20, 30], 12), 1)
    assert.equal(nearestIndex([0, 10, 20, 30], 26), 3)
    assert.equal(nearestIndex([0, 10, 20, 30], -5), 0)
    assert.equal(nearestIndex([], 5), 0)
  })
})

describe('formatAxisTicks', () => {
  it('keeps one unit and one precision across the axis', () => {
    assert.deepEqual(formatAxisTicks([0, 2.2, 4.4]), ['0,0 с', '2,2 с', '4,4 с'])
    assert.deepEqual(formatAxisTicks([0, 21.5, 43]), ['0 с', '22 с', '43 с'])
    assert.deepEqual(formatAxisTicks([0, 900, 1800]), ['0 хв', '15 хв', '30 хв'])
    assert.deepEqual(formatAxisTicks([0, 5400, 10800]), ['0 год', '1,5 год', '3 год'])
  })

  it('handles an axis of zeros', () => {
    assert.deepEqual(formatAxisTicks([0, 0, 0]), ['0,0 с', '0,0 с', '0,0 с'])
  })
})
