// src/export/avcSets.ts
import { buildAvcConfig, forEachUnit, hex, joinUnits, parseAvcConfig } from './avc.ts'
import type { AvcConfig } from './avc.ts'
import { unescape } from './avcBits.ts'
import {
  parsePps,
  parseSliceHeader,
  parseSps,
  renumberPps,
  renumberSlice,
  renumberSps,
} from './avcParse.ts'
import type { Pps, Sps } from './avcParse.ts'

// H.264 from several files in one output. The parameter sets of every file
// are put into the description of the output's track under numbers of their
// own, and a slice that points at a set under another number is moved to the
// new one. Nothing is added to the stream itself: players that read the
// description once and ignore parameter sets met later still find everything.

const SPS_LIMIT = 32
const PPS_LIMIT = 256

interface Parsed {
  config: AvcConfig
  sps: Map<number, Sps>
  pps: Map<number, Pps>
}

function typeOf(unit: Uint8Array): number {
  return (unit[0] ?? 0) & 0x1f
}

// Null when the description cannot be read, or holds something the rewrite
// does not cover (slice groups, data partitioning).
function parseStream(description: Uint8Array | null | undefined): Parsed | null {
  const config = parseAvcConfig(description)
  if (!config) return null
  const sps = new Map<number, Sps>()
  const pps = new Map<number, Pps>()
  try {
    for (const unit of config.sps) {
      if (typeOf(unit) !== 7) return null
      const parsed = parseSps(unit)
      if (parsed.profile === 88) return null
      sps.set(parsed.id, parsed)
    }
    for (const unit of config.pps) {
      if (typeOf(unit) !== 8) return null
      const parsed = parsePps(unit)
      if (!parsed || !sps.has(parsed.spsId)) return null
      pps.set(parsed.id, parsed)
    }
  } catch {
    return null
  }
  return { config, sps, pps }
}

function formatOf(sps: Sps): string {
  const chroma = ['4:0:0', '4:2:0', '4:2:2', '4:4:4'][sps.chromaFormat] ?? '?'
  return `${chroma}, ${sps.lumaDepth} біт`
}

// Why two files cannot be joined, or null when they can: their NAL length
// fields and picture formats have to agree, the sets themselves may differ.
export function avcMismatch(
  source: Uint8Array | null | undefined,
  target: Uint8Array | null | undefined,
): string | null {
  const ours = parseStream(source)
  const theirs = parseStream(target)
  if (!ours) return 'опис файлу не розібрано або не підтримується'
  if (!theirs) return 'опис кодувальника не розібрано або не підтримується'
  if (ours.config.lengthSize !== theirs.config.lengthSize) {
    return `поле довжини NAL: файл ${ours.config.lengthSize}, кодувальник ${theirs.config.lengthSize}`
  }
  const reference = theirs.sps.values().next().value
  if (!reference) return 'опис кодувальника не розібрано або не підтримується'
  for (const sps of ours.sps.values()) {
    if (
      sps.chromaFormat !== reference.chromaFormat ||
      sps.lumaDepth !== reference.lumaDepth ||
      sps.chromaDepth !== reference.chromaDepth
    ) {
      return `формат пікселів: файл ${formatOf(sps)}, кодувальник ${formatOf(reference)}`
    }
  }
  return null
}

export function avcCompatible(
  source: Uint8Array | null | undefined,
  target: Uint8Array | null | undefined,
): boolean {
  return avcMismatch(source, target) === null
}

// A buffering period message names a sequence parameter set by number.
function hasBufferingPeriod(unit: Uint8Array): boolean {
  let pos = 1
  let type = 0
  while (unit[pos] === 0xff) {
    type += 255
    pos++
  }
  type += unit[pos] ?? 0
  return type === 0
}

interface Entry {
  parsed: Parsed
  spsMap: Map<number, number>
  ppsMap: Map<number, number>
  // Whether any number of this file changed.
  moved: boolean
  slicesMoved: boolean
  known: Set<string>
}

function allocate(wanted: number, used: Set<number>, limit: number): number | null {
  if (!used.has(wanted)) return wanted
  for (let id = 0; id < limit; id++) if (!used.has(id)) return id
  return null
}

export interface StreamDescription {
  key: string
  description: Uint8Array | null | undefined
}

export class ParameterRegistry {
  // The description of the output track, holding every set.
  readonly description: Uint8Array
  readonly codecString: string
  // The NAL length field size shared by every stream.
  readonly lengthSize: number
  private readonly entries: Map<string, Entry>

  private constructor(
    description: Uint8Array,
    codecString: string,
    lengthSize: number,
    entries: Map<string, Entry>,
  ) {
    this.description = description
    this.codecString = codecString
    this.lengthSize = lengthSize
    this.entries = entries
  }

  // Streams are numbered in the order given: the first keeps its own numbers,
  // later ones keep theirs where free. Identical sets are stored once.
  static create(streams: StreamDescription[]): ParameterRegistry | null {
    const spsUnits = new Map<number, Uint8Array>()
    const ppsUnits = new Map<number, Uint8Array>()
    const spsByContent = new Map<string, number>()
    const ppsByContent = new Map<string, number>()
    const entries = new Map<string, Entry>()
    let lengthSize = 0

    for (const { key, description } of streams) {
      const parsed = parseStream(description)
      if (!parsed) return null
      if (lengthSize !== 0 && parsed.config.lengthSize !== lengthSize) return null
      lengthSize = parsed.config.lengthSize
      const spsMap = new Map<number, number>()
      const ppsMap = new Map<number, number>()
      const known = new Set<string>()

      try {
        for (const unit of parsed.config.sps) {
          known.add(hex(unit))
          const id = parseSps(unit).id
          const content = hex(renumberSps(unit, 0))
          let next = spsByContent.get(content)
          if (next === undefined) {
            const free = allocate(id, new Set(spsUnits.keys()), SPS_LIMIT)
            if (free === null) return null
            next = free
            spsByContent.set(content, next)
            spsUnits.set(next, next === id ? unit : renumberSps(unit, next))
          }
          spsMap.set(id, next)
        }
        for (const unit of parsed.config.pps) {
          known.add(hex(unit))
          const pps = parsePps(unit)
          const spsId = pps ? spsMap.get(pps.spsId) : undefined
          if (!pps || spsId === undefined) return null
          const content = hex(renumberPps(unit, 0, spsId))
          let next = ppsByContent.get(content)
          if (next === undefined) {
            const free = allocate(pps.id, new Set(ppsUnits.keys()), PPS_LIMIT)
            if (free === null) return null
            next = free
            ppsByContent.set(content, next)
            const same = next === pps.id && spsId === pps.spsId
            ppsUnits.set(next, same ? unit : renumberPps(unit, next, spsId))
          }
          ppsMap.set(pps.id, next)
        }
      } catch {
        return null
      }

      const differs = (map: Map<number, number>) => [...map].some(([from, to]) => from !== to)
      const slicesMoved = differs(ppsMap)
      entries.set(key, {
        parsed,
        spsMap,
        ppsMap,
        slicesMoved,
        moved: slicesMoved || differs(spsMap),
        known,
      })
    }
    if (entries.size === 0) return null

    const sorted = (units: Map<number, Uint8Array>) =>
      [...units].sort((a, b) => a[0] - b[0]).map(([, unit]) => unit)
    const spsList = sorted(spsUnits)
    const ppsList = sorted(ppsUnits)
    const infos = spsList.map((unit) => parseSps(unit))
    const top = infos.reduce((best, sps) => (sps.profile > best.profile ? sps : best))
    let compatibility = 0xff
    for (const sps of infos) if (sps.profile === top.profile) compatibility &= sps.compatibility
    const level = Math.max(...infos.map((sps) => sps.level))
    const description = buildAvcConfig({
      profile: top.profile,
      compatibility,
      level,
      lengthSize,
      sps: spsList,
      pps: ppsList,
      chroma: top.chromaFormat,
      lumaDepth: top.lumaDepth,
      chromaDepth: top.chromaDepth,
    })
    const part = (value: number) => value.toString(16).padStart(2, '0')
    const codecString = `avc1.${part(top.profile)}${part(compatibility)}${part(level)}`
    return new ParameterRegistry(description, codecString, lengthSize, entries)
  }

  // Whether a description is made of exactly the sets the stream was
  // registered with.
  matches(key: string, description: Uint8Array | null | undefined): boolean {
    const entry = this.entries.get(key)
    const config = parseAvcConfig(description)
    if (!entry || !config) return false
    const units = [...config.sps, ...config.pps]
    return units.length === entry.known.size && units.every((unit) => entry.known.has(hex(unit)))
  }

  // Whether the packets of a stream are changed on their way into the output.
  rewrites(key: string): boolean {
    return this.entries.get(key)?.moved ?? false
  }

  // The packet as the output needs it, the same array when nothing changes.
  // Null when the packet holds something that cannot be moved.
  rewrite(key: string, data: Uint8Array): Uint8Array | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    const units: Uint8Array[] = []
    let changed = false
    try {
      forEachUnit(data, entry.parsed.config.lengthSize, (unit) => {
        const type = typeOf(unit)
        if (type === 7 || type === 8) {
          if (!entry.known.has(hex(unit))) throw new RangeError('Невідомий набір параметрів.')
          changed = true
          return
        }
        if (type >= 2 && type <= 4) throw new RangeError('Розділені дані не підтримуються.')
        if (type === 6 && entry.moved && hasBufferingPeriod(unit)) {
          changed = true
          return
        }
        if ((type === 1 || type === 5) && entry.slicesMoved) {
          const head = unit[0] ?? 0
          const rbsp = unescape(unit.subarray(1))
          const header = parseSliceHeader(
            rbsp,
            type,
            (head >> 5) & 3,
            (id) => entry.parsed.sps.get(id),
            (id) => entry.parsed.pps.get(id),
          )
          const next = entry.ppsMap.get(header.ppsId)
          if (next === undefined) throw new RangeError('Невідомий набір параметрів.')
          if (next !== header.ppsId) {
            units.push(renumberSlice(head, rbsp, header, next))
            changed = true
            return
          }
        }
        units.push(unit)
      })
    } catch {
      return null
    }
    return changed ? joinUnits(units, entry.parsed.config.lengthSize) : data
  }
}

// Whether a packet holds a picture that can start a stretch: only an
// instantaneous decoder refresh may switch to another sequence parameter set.
export function startsWithIdr(data: Uint8Array, lengthSize: number): boolean {
  let found = false
  try {
    forEachUnit(data, lengthSize, (unit) => {
      if (typeOf(unit) === 5) found = true
    })
  } catch {
    return false
  }
  return found
}
