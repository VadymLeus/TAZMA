// tests/avcSets.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { forEachUnit, parseAvcConfig } from '../src/export/avc.ts'
import { unescape } from '../src/export/avcBits.ts'
import { ParameterRegistry, avcCompatible, avcMismatch, startsWithIdr } from '../src/export/avcSets.ts'
import { parsePps, parseSliceHeader, parseSps, renumberSlice } from '../src/export/avcParse.ts'
import { avcC, packetOf } from './avcFixture.ts'
import { STREAMS, bytes } from './avcStreams.ts'

const desc = (name: keyof typeof STREAMS) => bytes(STREAMS[name].description)
const packets = (name: keyof typeof STREAMS) => STREAMS[name].packets.map(bytes)

function registryOf(...names: (keyof typeof STREAMS)[]) {
  return ParameterRegistry.create(names.map((name) => ({ key: name, description: desc(name) })))
}

// The set numbers a rewritten packet ends up using, read against the
// registry's description.
function numbersOf(registry: ParameterRegistry, packet: Uint8Array) {
  const config = parseAvcConfig(registry.description)!
  const sps = new Map(config.sps.map((unit) => [parseSps(unit).id, parseSps(unit)]))
  const pps = new Map(config.pps.map((unit) => [parsePps(unit)!.id, parsePps(unit)!]))
  const found: { ppsId: number; spsId: number; cabac: boolean }[] = []
  forEachUnit(packet, config.lengthSize, (unit) => {
    const type = (unit[0] ?? 0) & 31
    if (type !== 1 && type !== 5) return
    const header = parseSliceHeader(
      unescape(unit.subarray(1)),
      type,
      ((unit[0] ?? 0) >> 5) & 3,
      (id) => sps.get(id),
      (id) => pps.get(id),
    )
    found.push({ ppsId: header.ppsId, spsId: pps.get(header.ppsId)!.spsId, cabac: header.cabac })
  })
  return found
}

describe('ParameterRegistry', () => {
  it('gives each different set a number of its own', () => {
    const registry = registryOf('cabac', 'cavlc', 'cavlcb')!
    const config = parseAvcConfig(registry.description)!
    // The two High streams share one sequence parameter set and differ in
    // the picture parameter set.
    assert.deepEqual(config.sps.map((unit) => parseSps(unit).id), [0, 1])
    assert.deepEqual(config.pps.map((unit) => parsePps(unit)!.id), [0, 1, 2])
    assert.deepEqual(config.pps.map((unit) => parsePps(unit)!.spsId), [0, 1, 0])
    assert.equal(config.lengthSize, 4)
  })

  it('keeps the numbers of the first stream and its packets untouched', () => {
    const registry = registryOf('cabac', 'cavlc')!
    assert.equal(registry.rewrites('cabac'), false)
    for (const packet of packets('cabac')) assert.equal(registry.rewrite('cabac', packet), packet)
  })

  it('moves the slices of a stream whose numbers are taken', () => {
    const registry = registryOf('cabac', 'cavlc', 'cavlcb')!
    assert.equal(registry.rewrites('cavlc'), true)
    for (const [name, number, sps, cabac] of [
      ['cavlc', 1, 1, false],
      ['cavlcb', 2, 0, false],
    ] as const) {
      for (const packet of packets(name)) {
        const moved = registry.rewrite(name, packet)
        assert.ok(moved)
        assert.notEqual(moved, packet)
        for (const slice of numbersOf(registry, moved)) {
          assert.deepEqual(slice, { ppsId: number, spsId: sps, cabac })
        }
      }
    }
  })

  it('stores identical sets once', () => {
    const registry = ParameterRegistry.create([
      { key: 'a', description: desc('cabac') },
      { key: 'b', description: desc('cabac') },
      { key: 'c', description: desc('cavlc') },
    ])!
    const config = parseAvcConfig(registry.description)!
    assert.equal(config.sps.length, 2)
    assert.equal(config.pps.length, 2)
    assert.equal(registry.rewrites('b'), false)
    assert.equal(registry.rewrites('c'), true)
    const [first] = packets('cabac')
    assert.equal(registry.rewrite('b', first!), first)
  })

  it('describes the strongest profile and the highest level', () => {
    const registry = registryOf('cavlc', 'cabac')!
    const [, profile, , level] = registry.description
    assert.equal(profile, 100)
    assert.equal(registry.codecString, `avc1.64${(0).toString(16).padStart(2, '0')}${level!.toString(16).padStart(2, '0')}`)
    assert.equal(registryOf('cavlc')!.codecString.slice(0, 7), 'avc1.42')
  })

  it('knows the description of a stream by its sets', () => {
    const registry = registryOf('cabac', 'cavlc')!
    assert.equal(registry.matches('cabac', desc('cabac')), true)
    assert.equal(registry.matches('cabac', desc('cavlc')), false)
    assert.equal(registry.matches('other', desc('cabac')), false)
    assert.equal(registry.matches('cabac', null), false)
  })

  it('refuses what it cannot read', () => {
    assert.equal(ParameterRegistry.create([]), null)
    assert.equal(ParameterRegistry.create([{ key: 'x', description: Uint8Array.of(1, 2, 3) }]), null)
    assert.equal(ParameterRegistry.create([{ key: 'x', description: avcC([[0x67, 1]], [[0x68, 2]]) }]), null)
  })

  it('refuses streams with another NAL length field size', () => {
    const config = parseAvcConfig(desc('cabac'))!
    const short = avcC(
      config.sps.map((unit) => [...unit]),
      config.pps.map((unit) => [...unit]),
      2,
    )
    const registry = ParameterRegistry.create([
      { key: 'a', description: desc('cabac') },
      { key: 'b', description: short },
    ])
    assert.equal(registry, null)
  })
})

describe('rewrite of other units', () => {
  const registry = registryOf('cabac', 'cavlc')!
  const config = parseAvcConfig(desc('cavlc'))!
  const [sps] = config.sps
  const [pps] = config.pps
  const idr = (name: keyof typeof STREAMS) => packets(name)[0]!

  function units(packet: Uint8Array) {
    const out: number[] = []
    forEachUnit(packet, 4, (unit) => out.push((unit[0] ?? 0) & 31))
    return out
  }

  it('drops parameter sets that were in the packet', () => {
    const base = units(idr('cavlc'))
    const head = packetOf([[...sps!], [...pps!]])
    const joined = Uint8Array.from([...head, ...idr('cavlc')])
    assert.deepEqual(units(joined), [7, 8, ...base])
    assert.deepEqual(units(registry.rewrite('cavlc', joined)!), base)
    const own = parseAvcConfig(desc('cabac'))!
    const same = Uint8Array.from([...packetOf([[...own.sps[0]!], [...own.pps[0]!]]), ...idr('cabac')])
    const kept = registry.rewrite('cabac', same)!
    assert.deepEqual([...kept], [...idr('cabac')])
  })

  it('refuses parameter sets the stream does not have', () => {
    const stranger = packetOf([[...parseAvcConfig(desc('cabac'))!.sps[0]!]])
    assert.equal(registry.rewrite('cavlc', Uint8Array.from([...stranger, ...idr('cavlc')])), null)
  })

  it('drops buffering period messages of moved streams only', () => {
    const sei = packetOf([[0x06, 0x00, 0x01, 0xaa, 0x80]])
    const withSei = (name: keyof typeof STREAMS) => Uint8Array.from([...sei, ...idr(name)])
    assert.deepEqual(units(registry.rewrite('cavlc', withSei('cavlc'))!), units(idr('cavlc')))
    assert.deepEqual(units(registry.rewrite('cabac', withSei('cabac'))!), [6, ...units(idr('cabac'))])
    const timing = packetOf([[0x06, 0x01, 0x01, 0xaa, 0x80]])
    const moved = registry.rewrite('cavlc', Uint8Array.from([...timing, ...idr('cavlc')]))!
    assert.deepEqual(units(moved), [6, ...units(idr('cavlc'))])
  })

  it('refuses data partitioning, broken packets and unknown streams', () => {
    assert.equal(registry.rewrite('cavlc', packetOf([[0x62, 1, 2, 3]])), null)
    const cut = idr('cavlc').subarray(0, idr('cavlc').length - 3)
    assert.equal(registry.rewrite('cavlc', cut), null)
    assert.equal(registry.rewrite('nobody', idr('cavlc')), null)
  })

  it('refuses a slice that points at a set the stream lacks', () => {
    let slice: Uint8Array | null = null
    forEachUnit(idr('cavlc'), 4, (unit) => {
      if (((unit[0] ?? 0) & 31) === 5) slice = unit
    })
    const unit = slice!
    const set = parseAvcConfig(desc('cavlc'))!
    const header = parseSliceHeader(
      unescape(unit.subarray(1)),
      5,
      ((unit[0] ?? 0) >> 5) & 3,
      () => parseSps(set.sps[0]!),
      () => parsePps(set.pps[0]!)!,
    )
    const stray = renumberSlice(unit[0] ?? 0, unescape(unit.subarray(1)), header, 77)
    assert.equal(registry.rewrite('cavlc', packetOf([[...stray]])), null)
  })
})

describe('startsWithIdr', () => {
  it('looks for an instantaneous refresh picture', () => {
    assert.equal(startsWithIdr(packets('cabac')[0]!, 4), true)
    assert.equal(startsWithIdr(packets('cabac')[1]!, 4), false)
    assert.equal(startsWithIdr(Uint8Array.of(0, 0, 0, 9), 4), false)
  })
})

describe('avcMismatch', () => {
  it('lets different sets of the same picture format through', () => {
    assert.equal(avcMismatch(desc('cavlc'), desc('cabac')), null)
    assert.equal(avcCompatible(desc('cabac'), desc('cavlcb')), true)
  })

  it('names what is wrong', () => {
    assert.match(avcMismatch(null, desc('cabac'))!, /файлу/)
    assert.match(avcMismatch(desc('cabac'), Uint8Array.of(1))!, /кодувальника/)
    const config = parseAvcConfig(desc('cabac'))!
    const narrow = avcC(
      config.sps.map((unit) => [...unit]),
      config.pps.map((unit) => [...unit]),
      2,
    )
    assert.match(avcMismatch(narrow, desc('cabac'))!, /поле довжини NAL: файл 2, кодувальник 4/)
  })
})
