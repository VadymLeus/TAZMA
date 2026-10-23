// tests/standCsv.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toCsv } from '../src/stand/csv.ts'

describe('toCsv', () => {
  it('writes the header and the rows in the order of the columns', () => {
    const text = toCsv([{ b: 2, a: 'x' }, { a: 'y', b: 3.5 }], ['a', 'b'])
    assert.equal(text, 'a,b\r\nx,2\r\ny,3.5\r\n')
  })

  it('quotes what holds a comma, a quote or a line break', () => {
    const text = toCsv([{ a: 'one, two', b: 'say "hi"', c: 'x\ny' }], ['a', 'b', 'c'])
    assert.equal(text, 'a,b,c\r\n"one, two","say ""hi""","x\ny"\r\n')
  })

  it('leaves missing values and numbers that are not finite empty', () => {
    const text = toCsv([{ a: null, b: undefined, c: Number.NaN, d: Infinity, e: false }], ['a', 'b', 'c', 'd', 'e', 'f'])
    assert.equal(text, 'a,b,c,d,e,f\r\n,,,,false,\r\n')
  })

  it('gives just the header for no rows', () => {
    assert.equal(toCsv([], ['a', 'b']), 'a,b\r\n')
  })
})
