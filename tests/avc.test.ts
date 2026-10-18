// tests/avc.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAvcConfig, forEachUnit, joinUnits, parseAvcConfig } from '../src/export/avc.ts'
import { avcC, packetOf } from './avcFixture.ts'

const SPS_A = [0x67, 0x64, 0x00, 0x1f]
const PPS_A = [0x68, 0xee, 0x3c]
const SPS_B = [0x67, 0x4d, 0x40, 0x28, 0x01]
const PPS_B = [0x68, 0xce]
const IDR = [0x65, 0x88, 0x84, 0x00]

describe('parseAvcConfig', () => {
  it('reads the length field size and the parameter sets', () => {
    const config = parseAvcConfig(avcC([SPS_A, SPS_B], [PPS_A, PPS_B], 4))
    assert.equal(config?.lengthSize, 4)
    assert.deepEqual(config?.sps.map((unit) => [...unit]), [SPS_A, SPS_B])
    assert.deepEqual(config?.pps.map((unit) => [...unit]), [PPS_A, PPS_B])
    assert.equal(parseAvcConfig(avcC([SPS_A], [PPS_A], 2))?.lengthSize, 2)
  })

  it('rejects records it cannot read', () => {
    assert.equal(parseAvcConfig(null), null)
    assert.equal(parseAvcConfig(Uint8Array.of(1, 2, 3)), null)
    assert.equal(parseAvcConfig(Uint8Array.of(2, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67)), null)
    const cut = avcC([SPS_A], [PPS_A]).slice(0, 9)
    assert.equal(parseAvcConfig(cut), null)
  })
})

describe('buildAvcConfig', () => {
  const info = {
    profile: 0x64,
    compatibility: 0,
    level: 0x1f,
    lengthSize: 4,
    sps: [Uint8Array.from(SPS_A), Uint8Array.from(SPS_B)],
    pps: [Uint8Array.from(PPS_A), Uint8Array.from(PPS_B)],
    chroma: 1,
    lumaDepth: 8,
    chromaDepth: 8,
  }

  it('writes a record that reads back', () => {
    const config = parseAvcConfig(buildAvcConfig(info))
    assert.equal(config?.lengthSize, 4)
    assert.deepEqual(config?.sps.map((unit) => [...unit]), [SPS_A, SPS_B])
    assert.deepEqual(config?.pps.map((unit) => [...unit]), [PPS_A, PPS_B])
  })

  it('adds the chroma and depth bytes for high profiles only', () => {
    const high = buildAvcConfig(info)
    assert.deepEqual([...high.subarray(high.length - 4)], [0xfd, 0xf8, 0xf8, 0])
    const main = buildAvcConfig({ ...info, profile: 0x4d })
    assert.equal(main.length, high.length - 4)
  })
})

describe('units of a packet', () => {
  it('splits and joins length-prefixed units', () => {
    const packet = packetOf([SPS_A, IDR, PPS_A], 4)
    const seen: number[][] = []
    forEachUnit(packet, 4, (unit) => seen.push([...unit]))
    assert.deepEqual(seen, [SPS_A, IDR, PPS_A])
    assert.deepEqual([...joinUnits(seen.map((unit) => Uint8Array.from(unit)), 4)], [...packet])
  })

  it('works with other length field sizes', () => {
    for (const size of [1, 2, 3]) {
      const packet = packetOf([IDR, PPS_A], size)
      const seen: number[][] = []
      forEachUnit(packet, size, (unit) => seen.push([...unit]))
      assert.deepEqual(seen, [IDR, PPS_A])
      assert.deepEqual([...joinUnits(seen.map((unit) => Uint8Array.from(unit)), size)], [...packet])
    }
  })

  it('refuses a packet cut short', () => {
    const packet = packetOf([IDR], 4)
    assert.throws(() => forEachUnit(packet.subarray(0, packet.length - 1), 4, () => {}))
  })
})
