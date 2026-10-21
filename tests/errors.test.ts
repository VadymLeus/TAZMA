// tests/errors.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeError, isDecoderError } from '../src/export/errors.ts'

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

describe('isDecoderError', () => {
  it('knows the error a decoder gives', () => {
    const error = new Error('Decoding error.')
    error.name = 'EncodingError'
    assert.equal(isDecoderError(error), true)
    assert.equal(isDecoderError(new Error('EncodingError: Decoding error. (avc1)')), true)
  })

  it('does not take a cancelled export or a full disk for it', () => {
    const aborted = new Error('Експорт скасовано')
    aborted.name = 'AbortError'
    assert.equal(isDecoderError(aborted), false)
    assert.equal(isDecoderError(new Error('The quota has been exceeded.')), false)
    assert.equal(isDecoderError('Decoding error.'), false)
  })
})
