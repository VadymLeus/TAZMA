// tests/avcParse.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { forEachUnit, parseAvcConfig } from '../src/export/avc.ts'
import { BitWriter, unescape } from '../src/export/avcBits.ts'
import {
  parsePps,
  parseSliceHeader,
  parseSps,
  renumberPps,
  renumberSlice,
  renumberSps,
} from '../src/export/avcParse.ts'
import { STREAMS, bytes } from './avcStreams.ts'

function load(name: keyof typeof STREAMS) {
  const stream = STREAMS[name]
  const config = parseAvcConfig(bytes(stream.description))!
  const sps = new Map(config.sps.map((unit) => [parseSps(unit).id, parseSps(unit)]))
  const pps = new Map(config.pps.map((unit) => [parsePps(unit)!.id, parsePps(unit)!]))
  const slices: Uint8Array[] = []
  for (const packet of stream.packets) {
    forEachUnit(bytes(packet), config.lengthSize, (unit) => {
      const type = (unit[0] ?? 0) & 31
      if (type === 1 || type === 5) slices.push(unit)
    })
  }
  return { config, sps, pps, slices }
}

const headerOf = (unit: Uint8Array, set: ReturnType<typeof load>) =>
  parseSliceHeader(
    unescape(unit.subarray(1)),
    (unit[0] ?? 0) & 31,
    ((unit[0] ?? 0) >> 5) & 3,
    (id) => set.sps.get(id),
    (id) => set.pps.get(id),
  )

describe('parameter sets', () => {
  it('reads the fields that matter', () => {
    const high = load('cabac')
    assert.equal(high.sps.get(0)?.profile, 100)
    assert.equal(high.sps.get(0)?.chromaFormat, 1)
    assert.equal(high.sps.get(0)?.lumaDepth, 8)
    assert.equal(high.pps.get(0)?.cabac, true)
    const base = load('cavlc')
    assert.equal(base.sps.get(0)?.profile, 66)
    assert.equal(base.pps.get(0)?.cabac, false)
    assert.equal(load('cavlcb').pps.get(0)?.cabac, false)
  })

  it('renumbers a set and leaves the rest as it was', () => {
    for (const name of ['cabac', 'cavlc', 'cavlcb'] as const) {
      const { config } = load(name)
      const sps = config.sps[0]!
      const pps = config.pps[0]!
      assert.deepEqual([...renumberSps(sps, 0)], [...sps])
      assert.deepEqual([...renumberPps(pps, 0, 0)], [...pps])
      const moved = renumberSps(sps, 9)
      assert.equal(parseSps(moved).id, 9)
      assert.deepEqual({ ...parseSps(moved), id: 0 }, parseSps(sps))
      assert.deepEqual([...renumberSps(moved, 0)], [...sps])
      const movedPps = renumberPps(pps, 12, 9)
      assert.equal(parsePps(movedPps)?.id, 12)
      assert.equal(parsePps(movedPps)?.spsId, 9)
      assert.deepEqual([...renumberPps(movedPps, 0, 0)], [...pps])
    }
  })

  it('refuses pictures split into slice groups', () => {
    const writer = new BitWriter()
    writer.ue(0)
    writer.ue(0)
    writer.bits(0, 2)
    writer.ue(1)
    writer.ue(0)
    writer.bit(1)
    writer.alignWith(0)
    assert.equal(parsePps(Uint8Array.of(0x68, ...writer.result())), null)
  })
})

describe('slice headers', () => {
  it('finds the end of every header', () => {
    for (const name of ['cabac', 'cavlc', 'cavlcb'] as const) {
      const set = load(name)
      assert.equal(set.slices.length, 6)
      for (const unit of set.slices) {
        const header = headerOf(unit, set)
        assert.equal(header.ppsId, 0)
        assert.equal(header.cabac, name === 'cabac')
        assert.ok(header.headerEnd > header.ppsEnd)
        assert.ok(header.headerEnd < unescape(unit.subarray(1)).length * 8)
      }
    }
  })

  it('moves a slice to another set and back without changing a bit', () => {
    for (const name of ['cabac', 'cavlc', 'cavlcb'] as const) {
      const set = load(name)
      for (const unit of set.slices) {
        const head = unit[0] ?? 0
        const rbsp = unescape(unit.subarray(1))
        const header = headerOf(unit, set)
        for (const id of [0, 1, 5, 200]) {
          const moved = renumberSlice(head, rbsp, header, id)
          const movedRbsp = unescape(moved.subarray(1))
          const next = new Map(set.pps)
          const base = set.pps.get(0)!
          next.set(id, { ...base, id })
          const again = parseSliceHeader(
            movedRbsp,
            head & 31,
            (head >> 5) & 3,
            (key) => set.sps.get(key),
            (key) => next.get(key),
          )
          assert.equal(again.ppsId, id)
          const back = renumberSlice(head, movedRbsp, again, 0)
          assert.deepEqual([...back], [...unit])
        }
      }
    }
  })
})
