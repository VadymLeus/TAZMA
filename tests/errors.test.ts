// tests/errors.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeError } from '../src/export/errors.ts'

describe('describeError', () => {
  it('explains a failed memory allocation', () => {
    assert.match(describeError(new RangeError('Array buffer allocation failed')), /не вистачило пам’яті/)
    assert.match(describeError(new Error('Invalid typed array length: 3000000000')), /не вистачило пам’яті/)
  })

  it('explains a full storage', () => {
    const error = new Error('The quota has been exceeded.')
    error.name = 'QuotaExceededError'
    assert.match(describeError(error), /не вистачило місця/)
  })

  it('passes other messages through', () => {
    assert.equal(describeError(new Error('Таймлайн порожній.')), 'Таймлайн порожній.')
    assert.equal(describeError('boom'), 'boom')
  })
})
