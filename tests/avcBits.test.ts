// tests/avcBits.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BitReader, BitWriter, escape, stopBit, unescape } from '../src/export/avcBits.ts'

describe('emulation prevention', () => {
  it('removes and inserts the guard byte', () => {
    const escaped = Uint8Array.of(0, 0, 3, 1, 0, 0, 3, 0, 0, 3, 0, 3, 7)
    const raw = Uint8Array.of(0, 0, 1, 0, 0, 0, 0, 0, 3, 7)
    assert.deepEqual([...unescape(escaped)], [...raw])
    assert.deepEqual([...escape(raw)], [...escaped])
  })

  it('leaves data without long zero runs alone', () => {
    const data = Uint8Array.of(1, 0, 2, 0, 0, 4, 5)
    assert.deepEqual([...escape(data)], [...data])
    assert.deepEqual([...unescape(data)], [...data])
  })

  it('round trips random data', () => {
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
    for (let round = 0; round < 50; round++) {
      const data = Uint8Array.from({ length: 200 }, () => (next() % 5 === 0 ? next() % 4 : next() % 256))
      assert.deepEqual([...unescape(escape(data))], [...data])
    }
  })
})

describe('bit reading and writing', () => {
  it('round trips exp-Golomb codes', () => {
    const writer = new BitWriter()
    const values = [0, 1, 2, 3, 7, 8, 30, 255, 256, 65535, 100000]
    for (const value of values) writer.ue(value)
    const reader = new BitReader(writer.result())
    for (const value of values) assert.equal(reader.ue(), value)
  })

  it('reads signed codes', () => {
    const writer = new BitWriter()
    for (const code of [0, 1, 2, 3, 4]) writer.ue(code)
    const reader = new BitReader(writer.result())
    assert.deepEqual([0, 1, 2, 3, 4].map(() => reader.se()), [0, 1, -1, 2, -2])
  })

  it('reads fixed width fields and refuses to read past the end', () => {
    const reader = new BitReader(Uint8Array.of(0xa5, 0xff))
    assert.equal(reader.bits(4), 0xa)
    assert.equal(reader.bits(8), 0x5f)
    assert.equal(reader.bits(4), 0xf)
    assert.throws(() => reader.bit())
  })

  it('copies a bit range from any offset', () => {
    const source = Uint8Array.of(0b10110011, 0b01011100, 0b11110000)
    const writer = new BitWriter()
    writer.copy(source, 3, 19)
    const reader = new BitReader(writer.result())
    const expected = []
    for (let at = 3; at < 19; at++) expected.push(((source[at >> 3] ?? 0) >> (7 - (at & 7))) & 1)
    assert.deepEqual(expected.map(() => reader.bit()), expected)
  })

  it('copies any range to any offset the way a bit by bit copy would', () => {
    let seed = 11
    const next = (limit: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % limit
    const source = Uint8Array.from({ length: 40 }, () => next(256))
    const bitAt = (at: number) => ((source[at >> 3] ?? 0) >> (7 - (at & 7))) & 1
    for (let round = 0; round < 300; round++) {
      const from = next(150)
      const to = from + next(150)
      const lead = next(8)
      const writer = new BitWriter()
      const expected: number[] = []
      for (let index = 0; index < lead; index++) {
        writer.bit(1)
        expected.push(1)
      }
      writer.copy(source, from, to)
      for (let at = from; at < to; at++) expected.push(bitAt(at))
      assert.equal(writer.pos, expected.length)
      const reader = new BitReader(writer.result())
      assert.deepEqual(expected.map(() => reader.bit()), expected)
    }
  })

  it('aligns with the given bit and appends whole bytes', () => {
    const writer = new BitWriter()
    writer.bits(0b101, 3)
    writer.alignWith(1)
    writer.append(Uint8Array.of(9, 8))
    assert.deepEqual([...writer.result()], [0b10111111, 9, 8])
    const open = new BitWriter()
    open.bit(1)
    assert.throws(() => open.append(Uint8Array.of(1)))
  })

  it('finds the stop bit', () => {
    assert.equal(stopBit(Uint8Array.of(0xff, 0x80)), 8)
    assert.equal(stopBit(Uint8Array.of(0x12, 0x04, 0x00, 0x00)), 13)
    assert.throws(() => stopBit(Uint8Array.of(0, 0)))
  })
})
