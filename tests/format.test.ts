// tests/format.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSpan, framesText, framesWord } from '../src/media/format.ts'

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

describe('framesWord', () => {
  it('declines the word by the count', () => {
    assert.equal(framesWord(1), 'кадр')
    assert.equal(framesWord(2), 'кадри')
    assert.equal(framesWord(4), 'кадри')
    assert.equal(framesWord(5), 'кадрів')
    assert.equal(framesWord(0), 'кадрів')
    assert.equal(framesWord(11), 'кадрів')
    assert.equal(framesWord(12), 'кадрів')
    assert.equal(framesWord(14), 'кадрів')
    assert.equal(framesWord(21), 'кадр')
    assert.equal(framesWord(33), 'кадри')
    assert.equal(framesWord(111), 'кадрів')
    assert.equal(framesWord(1200), 'кадрів')
  })

  it('puts the count before the word', () => {
    assert.equal(framesText(3), '3 кадри')
    assert.equal(framesText(25), '25 кадрів')
  })
})
