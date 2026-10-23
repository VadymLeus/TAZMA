// tests/attempts.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attemptLabel, planAttempts } from '../src/export/attempts.ts'

describe('planAttempts', () => {
  it('falls back from the frame limit to the library, then to software decoding', () => {
    assert.deepEqual(planAttempts('auto'), [
      { flow: 'auto', software: false },
      { flow: 'library', software: false },
      { flow: 'library', software: true },
    ])
    assert.equal(planAttempts('fixed').length, 3)
  })

  it('goes straight to software decoding when there was no limit', () => {
    assert.deepEqual(planAttempts('library'), [
      { flow: 'library', software: false },
      { flow: 'library', software: true },
    ])
  })
})

describe('attemptLabel', () => {
  it('names the mode and the decoding', () => {
    assert.equal(attemptLabel({ flow: 'auto', software: false }), 'Авто')
    assert.equal(attemptLabel({ flow: 'fixed', software: false }), 'Вручну')
    assert.equal(attemptLabel({ flow: 'library', software: true }), 'Бібліотека, програмне декодування')
  })
})
