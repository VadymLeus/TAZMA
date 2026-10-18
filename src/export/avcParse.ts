// src/export/avcParse.ts
import { BitReader, BitWriter, escape, stopBit, unescape } from './avcBits.ts'

// What of the parameter sets and slice headers is needed to find the place of
// the picture parameter set number in a slice and to move it.

export interface Sps {
  id: number
  profile: number
  compatibility: number
  level: number
  chromaFormat: number
  lumaDepth: number
  chromaDepth: number
  separateColour: boolean
  log2MaxFrameNum: number
  pocType: number
  log2MaxPocLsb: number
  deltaPicOrderAlwaysZero: boolean
  frameMbsOnly: boolean
}

export interface Pps {
  id: number
  spsId: number
  cabac: boolean
  bottomFieldPicOrder: boolean
  numRefIdxL0: number
  numRefIdxL1: number
  weightedPred: boolean
  weightedBipred: number
  deblockingControl: boolean
  redundantPicCnt: boolean
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135])

function skipScalingList(reader: BitReader, size: number) {
  let last = 8
  let next = 8
  for (let index = 0; index < size; index++) {
    if (next !== 0) {
      next = (last + reader.se() + 256) % 256
    }
    last = next === 0 ? last : next
  }
}

// A parameter set unit starts with a one byte header.
export function parseSps(unit: Uint8Array): Sps {
  const reader = new BitReader(unescape(unit.subarray(1)))
  const profile = reader.bits(8)
  const compatibility = reader.bits(8)
  const level = reader.bits(8)
  const id = reader.ue()
  let chromaFormat = 1
  let separateColour = false
  let lumaDepth = 8
  let chromaDepth = 8
  if (HIGH_PROFILES.has(profile)) {
    chromaFormat = reader.ue()
    if (chromaFormat === 3) separateColour = reader.bit() === 1
    lumaDepth = reader.ue() + 8
    chromaDepth = reader.ue() + 8
    reader.bit()
    if (reader.bit() === 1) {
      const lists = chromaFormat !== 3 ? 8 : 12
      for (let index = 0; index < lists; index++) {
        if (reader.bit() === 1) skipScalingList(reader, index < 6 ? 16 : 64)
      }
    }
  }
  const log2MaxFrameNum = reader.ue() + 4
  const pocType = reader.ue()
  let log2MaxPocLsb = 0
  let deltaPicOrderAlwaysZero = false
  if (pocType === 0) {
    log2MaxPocLsb = reader.ue() + 4
  } else if (pocType === 1) {
    deltaPicOrderAlwaysZero = reader.bit() === 1
    reader.se()
    reader.se()
    const cycle = reader.ue()
    for (let index = 0; index < cycle; index++) reader.se()
  }
  reader.ue()
  reader.bit()
  reader.ue()
  reader.ue()
  const frameMbsOnly = reader.bit() === 1
  return {
    id,
    profile,
    compatibility,
    level,
    chromaFormat,
    lumaDepth,
    chromaDepth,
    separateColour,
    log2MaxFrameNum,
    pocType,
    log2MaxPocLsb,
    deltaPicOrderAlwaysZero,
    frameMbsOnly,
  }
}

// Returns null for pictures split into slice groups, which are not handled.
export function parsePps(unit: Uint8Array): Pps | null {
  const reader = new BitReader(unescape(unit.subarray(1)))
  const id = reader.ue()
  const spsId = reader.ue()
  const cabac = reader.bit() === 1
  const bottomFieldPicOrder = reader.bit() === 1
  if (reader.ue() > 0) return null
  const numRefIdxL0 = reader.ue() + 1
  const numRefIdxL1 = reader.ue() + 1
  const weightedPred = reader.bit() === 1
  const weightedBipred = reader.bits(2)
  reader.se()
  reader.se()
  reader.se()
  const deblockingControl = reader.bit() === 1
  reader.bit()
  const redundantPicCnt = reader.bit() === 1
  return {
    id,
    spsId,
    cabac,
    bottomFieldPicOrder,
    numRefIdxL0,
    numRefIdxL1,
    weightedPred,
    weightedBipred,
    deblockingControl,
    redundantPicCnt,
  }
}

export interface SliceHeader {
  // Where the picture parameter set number sits, and where the header ends.
  ppsStart: number
  ppsEnd: number
  ppsId: number
  headerEnd: number
  cabac: boolean
}

function skipWeights(reader: BitReader, count: number, chroma: boolean) {
  for (let index = 0; index < count; index++) {
    if (reader.bit() === 1) {
      reader.se()
      reader.se()
    }
    if (chroma && reader.bit() === 1) {
      for (let part = 0; part < 4; part++) reader.se()
    }
  }
}

function skipModification(reader: BitReader) {
  if (reader.bit() === 0) return
  for (;;) {
    const idc = reader.ue()
    if (idc === 3) return
    if (idc > 3) throw new RangeError('Некоректна зміна списку.')
    reader.ue()
  }
}

// nalType 1 or 5; rbsp is the unescaped payload without the unit header.
export function parseSliceHeader(
  rbsp: Uint8Array,
  nalType: number,
  nalRefIdc: number,
  spsOf: (id: number) => Sps | undefined,
  ppsOf: (id: number) => Pps | undefined,
): SliceHeader {
  const reader = new BitReader(rbsp)
  reader.ue()
  const sliceType = reader.ue() % 5
  const ppsStart = reader.pos
  const ppsId = reader.ue()
  const ppsEnd = reader.pos
  const pps = ppsOf(ppsId)
  const sps = pps ? spsOf(pps.spsId) : undefined
  if (!pps || !sps) throw new RangeError('Слайс посилається на невідомий набір параметрів.')
  if (sps.separateColour) reader.bits(2)
  reader.bits(sps.log2MaxFrameNum)
  let fieldPic = false
  if (!sps.frameMbsOnly) {
    fieldPic = reader.bit() === 1
    if (fieldPic) reader.bit()
  }
  if (nalType === 5) reader.ue()
  if (sps.pocType === 0) {
    reader.bits(sps.log2MaxPocLsb)
    if (pps.bottomFieldPicOrder && !fieldPic) reader.se()
  } else if (sps.pocType === 1 && !sps.deltaPicOrderAlwaysZero) {
    reader.se()
    if (pps.bottomFieldPicOrder && !fieldPic) reader.se()
  }
  if (pps.redundantPicCnt) reader.ue()
  const isB = sliceType === 1
  const predicted = sliceType === 0 || sliceType === 1 || sliceType === 3
  if (isB) reader.bit()
  let l0 = pps.numRefIdxL0
  let l1 = pps.numRefIdxL1
  if (predicted && reader.bit() === 1) {
    l0 = reader.ue() + 1
    if (isB) l1 = reader.ue() + 1
  }
  if (predicted) {
    skipModification(reader)
    if (isB) skipModification(reader)
  }
  const chromaArrayType = sps.separateColour ? 0 : sps.chromaFormat
  if ((pps.weightedPred && (sliceType === 0 || sliceType === 3)) || (pps.weightedBipred === 1 && isB)) {
    reader.ue()
    if (chromaArrayType !== 0) reader.ue()
    skipWeights(reader, l0, chromaArrayType !== 0)
    if (isB) skipWeights(reader, l1, chromaArrayType !== 0)
  }
  if (nalRefIdc !== 0) {
    if (nalType === 5) {
      reader.bit()
      reader.bit()
    } else if (reader.bit() === 1) {
      for (;;) {
        const operation = reader.ue()
        if (operation === 0) break
        if (operation > 6) throw new RangeError('Некоректна операція з опорними кадрами.')
        if (operation === 1 || operation === 3) reader.ue()
        if (operation === 2) reader.ue()
        if (operation === 3 || operation === 6) reader.ue()
        if (operation === 4) reader.ue()
      }
    }
  }
  if (pps.cabac && sliceType !== 2 && sliceType !== 4) reader.ue()
  reader.se()
  if (sliceType === 3 || sliceType === 4) {
    if (sliceType === 3) reader.bit()
    reader.se()
  }
  if (pps.deblockingControl && reader.ue() !== 1) {
    reader.se()
    reader.se()
  }
  return { ppsStart, ppsEnd, ppsId, headerEnd: reader.pos, cabac: pps.cabac }
}

// The unit with its header byte; the rest is rewritten bit by bit.
function withNumbers(unit: Uint8Array, write: (reader: BitReader, writer: BitWriter) => void): Uint8Array {
  const rbsp = unescape(unit.subarray(1))
  const reader = new BitReader(rbsp)
  const writer = new BitWriter()
  write(reader, writer)
  const end = stopBit(rbsp)
  writer.copy(rbsp, reader.pos, end)
  writer.bit(1)
  writer.alignWith(0)
  const body = escape(writer.result())
  const out = new Uint8Array(body.length + 1)
  out[0] = unit[0] ?? 0
  out.set(body, 1)
  return out
}

export function renumberSps(unit: Uint8Array, id: number): Uint8Array {
  return withNumbers(unit, (reader, writer) => {
    writer.copy(unescape(unit.subarray(1)), 0, 24)
    reader.pos = 24
    reader.ue()
    writer.ue(id)
  })
}

export function renumberPps(unit: Uint8Array, id: number, spsId: number): Uint8Array {
  return withNumbers(unit, (reader, writer) => {
    reader.ue()
    reader.ue()
    writer.ue(id)
    writer.ue(spsId)
  })
}

// Moves a slice to another picture parameter set; the picture data is kept.
// head is the unit's first byte, rbsp the unescaped rest.
export function renumberSlice(head: number, rbsp: Uint8Array, header: SliceHeader, id: number): Uint8Array {
  const writer = new BitWriter()
  writer.copy(rbsp, 0, header.ppsStart)
  writer.ue(id)
  writer.copy(rbsp, header.ppsEnd, header.headerEnd)
  if (header.cabac) {
    writer.alignWith(1)
    writer.append(rbsp.subarray(Math.ceil(header.headerEnd / 8)))
  } else {
    writer.copy(rbsp, header.headerEnd, stopBit(rbsp))
    writer.bit(1)
    writer.alignWith(0)
  }
  const body = escape(writer.result())
  const out = new Uint8Array(body.length + 1)
  out[0] = head
  out.set(body, 1)
  return out
}
