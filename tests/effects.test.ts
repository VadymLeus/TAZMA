// tests/effects.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampAmount, effectFilter, isActive } from '../src/project/effects.ts'

describe('effectFilter', () => {
  it('is none without an effect or with zero strength', () => {
    assert.equal(effectFilter(undefined), 'none')
    assert.equal(effectFilter({ kind: 'grayscale', amount: 0 }), 'none')
  })

  it('builds a grayscale filter with the amount', () => {
    assert.equal(effectFilter({ kind: 'grayscale', amount: 1 }), 'grayscale(1)')
    assert.equal(effectFilter({ kind: 'grayscale', amount: 0.25 }), 'grayscale(0.25)')
  })

  it('never goes outside 0..1', () => {
    assert.equal(effectFilter({ kind: 'grayscale', amount: 7 }), 'grayscale(1)')
  })
})

describe('isActive and clampAmount', () => {
  it('treats zero strength as no effect', () => {
    assert.equal(isActive(undefined), false)
    assert.equal(isActive({ kind: 'grayscale', amount: 0 }), false)
    assert.equal(isActive({ kind: 'grayscale', amount: 0.1 }), true)
  })

  it('clamps and survives NaN', () => {
    assert.equal(clampAmount(-2), 0)
    assert.equal(clampAmount(3), 1)
    assert.equal(clampAmount(Number.NaN), 0)
  })
})
