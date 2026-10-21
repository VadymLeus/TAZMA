// tests/crc32.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crc32 } from '../src/resume/crc32.ts'

const text = (value: string) => new TextEncoder().encode(value)

describe('crc32', () => {
  it('gives the standard value for the check string', () => {
    assert.equal(crc32(text('123456789')), 0xcbf43926)
  })

  it('gives 0 for nothing', () => {
    assert.equal(crc32(new Uint8Array(0)), 0)
  })

  it('goes on over the next block as if the data were one', () => {
    const whole = crc32(text('hello, world'))
    const split = crc32(text(' world'), crc32(text('hello,')))
    assert.equal(split, whole)
  })

  it('changes with a single flipped bit', () => {
    const data = text('a segment of the journal')
    const before = crc32(data)
    data[3] = (data[3] as number) ^ 1
    assert.notEqual(crc32(data), before)
  })
})
