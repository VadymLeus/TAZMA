// tests/credits.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CreditPool } from '../src/pipeline/credits.ts'

describe('CreditPool', () => {
  it('hands out as many credits as the limit allows', () => {
    const pool = new CreditPool(2)
    assert.equal(pool.tryAcquire(), true)
    assert.equal(pool.tryAcquire(), true)
    assert.equal(pool.tryAcquire(), false)
    assert.equal(pool.inFlight, 2)
    assert.equal(pool.free, 0)
  })

  it('takes a credit back and gives it out again', () => {
    const pool = new CreditPool(1)
    pool.tryAcquire()
    assert.equal(pool.tryAcquire(), false)
    pool.release()
    assert.equal(pool.tryAcquire(), true)
  })

  it('never goes below zero', () => {
    const pool = new CreditPool(2)
    pool.tryAcquire()
    pool.release(5)
    assert.equal(pool.inFlight, 0)
    pool.release(-3)
    assert.equal(pool.inFlight, 0)
  })

  it('keeps the peak and counts borrowed credits above the limit', () => {
    const pool = new CreditPool(1)
    pool.tryAcquire()
    pool.borrow()
    pool.borrow()
    assert.deepEqual(pool.stats(), { limit: 1, inFlight: 3, peak: 3, borrowed: 2, peakOver: 2 })
    pool.release(3)
    assert.equal(pool.stats().peak, 3)
    assert.equal(pool.stats().inFlight, 0)
  })

  it('waits for credits to come back when the limit is lowered', () => {
    const pool = new CreditPool(4)
    for (let i = 0; i < 4; i++) pool.tryAcquire()
    pool.setLimit(2)
    pool.release(1)
    assert.equal(pool.tryAcquire(), false)
    pool.release(2)
    assert.equal(pool.tryAcquire(), true)
  })

  it('rounds the limit down and keeps it at least one', () => {
    assert.equal(new CreditPool(3.9).limit, 3)
    assert.equal(new CreditPool(0).limit, 1)
    assert.equal(new CreditPool(Number.NaN).limit, 1)
    assert.equal(new CreditPool(-4).limit, 1)
  })

  it('has no limit when it is infinite', () => {
    const pool = new CreditPool(Infinity)
    for (let i = 0; i < 1000; i++) assert.equal(pool.tryAcquire(), true)
    assert.equal(pool.free, Infinity)
  })
})
