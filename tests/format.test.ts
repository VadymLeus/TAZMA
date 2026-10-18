// tests/format.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSpan } from '../src/media/format.ts'

describe('formatSpan', () => {
  it('prints seconds with one decimal and a comma', () => {
    assert.equal(formatSpan(3.24), '3,2 с')
    assert.equal(formatSpan(0), '0,0 с')
  })

  it('shows a dash for bad values', () => {
    assert.equal(formatSpan(Number.NaN), '—')
    assert.equal(formatSpan(-1), '—')
  })
})
