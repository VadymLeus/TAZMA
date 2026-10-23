// src/export/avc.ts

// An avcC record (the H.264 description in MP4): the NAL length field size and
// the parameter sets (units without length prefixes).
export interface AvcConfig {
  lengthSize: number
  sps: Uint8Array[]
  pps: Uint8Array[]
}

export function parseAvcConfig(description: Uint8Array | null | undefined): AvcConfig | null {
  if (!description || description.length < 7 || description[0] !== 1) return null
  const lengthSize = ((description[4] ?? 0) & 3) + 1
  let pos = 5
  const read = (count: number): Uint8Array[] | null => {
    const units: Uint8Array[] = []
    for (let index = 0; index < count; index++) {
      if (pos + 2 > description.length) return null
      const size = ((description[pos] ?? 0) << 8) | (description[pos + 1] ?? 0)
      pos += 2
      if (size === 0 || pos + size > description.length) return null
      units.push(description.subarray(pos, pos + size))
      pos += size
    }
    return units
  }
  const sps = read((description[pos++] ?? 0) & 0x1f)
  if (!sps || pos >= description.length) return null
  const pps = read(description[pos++] ?? 0)
  if (!pps || sps.length === 0 || pps.length === 0) return null
  return { lengthSize, sps, pps }
}

// profile_idc values whose avcC record carries the extra chroma and depth bytes.
const EXTENDED = new Set([100, 110, 122, 144, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135])

export interface AvcRecordInfo {
  profile: number
  compatibility: number
  level: number
  lengthSize: number
  sps: Uint8Array[]
  pps: Uint8Array[]
  // chroma_format_idc and the bit depths, for the extended record.
  chroma: number
  lumaDepth: number
  chromaDepth: number
}

export function buildAvcConfig(info: AvcRecordInfo): Uint8Array {
  const bytes: number[] = [
    1,
    info.profile,
    info.compatibility,
    info.level,
    0xfc | (info.lengthSize - 1),
    0xe0 | info.sps.length,
  ]
  for (const unit of info.sps) bytes.push(unit.length >> 8, unit.length & 0xff, ...unit)
  bytes.push(info.pps.length)
  for (const unit of info.pps) bytes.push(unit.length >> 8, unit.length & 0xff, ...unit)
  if (EXTENDED.has(info.profile)) {
    bytes.push(0xfc | info.chroma, 0xf8 | (info.lumaDepth - 8), 0xf8 | (info.chromaDepth - 8), 0)
  }
  return Uint8Array.from(bytes)
}

export function hex(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += byte.toString(16).padStart(2, '0')
  return text
}

// Calls back for every length-prefixed unit of a packet.
export function forEachUnit(
  data: Uint8Array,
  lengthSize: number,
  visit: (unit: Uint8Array) => void,
): void {
  let pos = 0
  while (pos + lengthSize <= data.length) {
    let size = 0
    for (let index = 0; index < lengthSize; index++) size = size * 256 + (data[pos + index] ?? 0)
    pos += lengthSize
    if (size === 0 || pos + size > data.length) throw new RangeError('Пошкоджений пакет H.264.')
    visit(data.subarray(pos, pos + size))
    pos += size
  }
}

export function joinUnits(units: Uint8Array[], lengthSize: number): Uint8Array {
  let total = 0
  for (const unit of units) total += lengthSize + unit.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const unit of units) {
    for (let index = lengthSize - 1; index >= 0; index--) {
      out[pos++] = Math.floor(unit.length / 2 ** (8 * index)) & 0xff
    }
    out.set(unit, pos)
    pos += unit.length
  }
  return out
}
