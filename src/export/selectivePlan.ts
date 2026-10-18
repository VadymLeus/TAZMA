// src/export/selectivePlan.ts
import { isActive } from '../project/effects.ts'
import { avcCompatible } from './avcSets.ts'
import type { TextItem } from '../project/types.ts'
import type { Segment } from './plan.ts'

export type RecodeReason = 'effect' | 'text' | 'edge' | 'short' | 'source'

export interface RecodePart {
  reason: RecodeReason
  from: number
  to: number
}

// Pieces cover each clip in source seconds, [from, to). A copy piece is a run
// of whole GOPs moved as packets; a recode piece is decoded, painted and
// encoded again. Neighbouring recode pieces of one clip are merged.
export type Piece =
  | { kind: 'copy'; segment: number; from: number; to: number; toEnd: boolean }
  | { kind: 'recode'; segment: number; from: number; to: number; parts: RecodePart[] }

export interface SegmentAnalysis {
  // Key packet timestamps around the clip, sorted, in source seconds.
  keyframes: number[]
  // End of the video stream in the source file.
  streamEnd: number
  // False when the stream cannot be mixed into the output as it is.
  copyable: boolean
}

export interface PlanOptions {
  // Copy runs shorter than this are not worth a separate encoder session.
  minCopy: number
}

export const DEFAULT_MIN_COPY = 0.5

const EPS = 1e-6
const END_TOLERANCE = 1e-3

interface Span {
  from: number
  to: number
  reason: 'effect' | 'text'
}

// Spans of one clip (source seconds) that need painting: the whole clip with
// an effect, otherwise the time under captions.
function dirtySpans(segment: Segment, texts: TextItem[]): Span[] {
  const { clip, start, end, offset } = segment
  if (isActive(clip.effect)) return [{ from: start, to: end, reason: 'effect' }]
  const spans: Span[] = []
  for (const text of texts) {
    const from = Math.max(start, start + (text.start - offset))
    const to = Math.min(end, start + (text.end - offset))
    if (to - from > EPS) spans.push({ from, to, reason: 'text' })
  }
  spans.sort((a, b) => a.from - b.from)
  const merged: Span[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.from <= last.to + EPS) last.to = Math.max(last.to, span.to)
    else merged.push({ ...span })
  }
  return merged
}

function planSegment(
  index: number,
  segment: Segment,
  texts: TextItem[],
  analysis: SegmentAnalysis,
  options: PlanOptions,
): Piece[] {
  const pieces: Piece[] = []

  const recode = (from: number, to: number, reason: RecodeReason) => {
    if (to - from <= EPS) return
    const last = pieces[pieces.length - 1]
    if (last && last.kind === 'recode' && Math.abs(last.to - from) <= EPS) {
      last.to = to
      const tail = last.parts[last.parts.length - 1]
      if (tail.reason === reason) tail.to = to
      else last.parts.push({ reason, from, to })
    } else {
      pieces.push({ kind: 'recode', segment: index, from, to, parts: [{ reason, from, to }] })
    }
  }

  const clean = (a: number, b: number) => {
    if (!analysis.copyable) return recode(a, b, 'source')
    const keys = analysis.keyframes
    const toEnd = b >= segment.end - EPS && segment.end >= analysis.streamEnd - END_TOLERANCE
    const first = keys.find((key) => key >= a - EPS)
    let last: number | undefined
    if (toEnd) last = b
    else for (const key of keys) if (key <= b + EPS) last = key
    if (first === undefined || last === undefined || last - first <= EPS) {
      return recode(a, b, 'edge')
    }
    if (last - first < Math.max(options.minCopy, EPS)) return recode(a, b, 'short')
    recode(a, first, 'edge')
    pieces.push({ kind: 'copy', segment: index, from: first, to: last, toEnd })
    recode(last, b, 'edge')
  }

  let cursor = segment.start
  for (const span of dirtySpans(segment, texts)) {
    if (span.from - cursor > EPS) clean(cursor, span.from)
    recode(span.from, span.to, span.reason)
    cursor = span.to
  }
  if (segment.end - cursor > EPS) clean(cursor, segment.end)
  return pieces
}

export function planSelective(
  segments: Segment[],
  texts: TextItem[],
  analyses: SegmentAnalysis[],
  options: PlanOptions = { minCopy: DEFAULT_MIN_COPY },
): Piece[] {
  return segments.flatMap((segment, index) =>
    planSegment(index, segment, texts, analyses[index], options),
  )
}

export interface PlanSummary {
  copySeconds: number
  recodeSeconds: number
  byReason: Record<RecodeReason, number>
}

export function summarizePlan(pieces: Piece[]): PlanSummary {
  const byReason: Record<RecodeReason, number> = {
    effect: 0,
    text: 0,
    edge: 0,
    short: 0,
    source: 0,
  }
  let copySeconds = 0
  for (const piece of pieces) {
    if (piece.kind === 'copy') copySeconds += piece.to - piece.from
    else for (const part of piece.parts) byReason[part.reason] += part.to - part.from
  }
  const recodeSeconds = Object.values(byReason).reduce((sum, value) => sum + value, 0)
  return { copySeconds, recodeSeconds, byReason }
}

export type CopyBlocker = 'no-video' | 'codec' | 'size' | 'rotation' | 'params' | 'color'

// Colour signalling of a stream; a missing field means "not stated".
export interface StreamColor {
  primaries?: string | null
  transfer?: string | null
  matrix?: string | null
  fullRange?: boolean | null
}

export interface SourceStream {
  codec: string | null
  codecString: string | null
  description: Uint8Array | null
  width: number
  height: number
  rotation: number
  color?: StreamColor | null
}

export interface TargetStream {
  codec: string
  codecString: string
  description: Uint8Array | null
  width: number
  height: number
  color?: StreamColor | null
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false
  return true
}

// Profile and bit depth of a dotted VP9 or AV1 codec string.
function profileAndDepth(codecString: string): string | null {
  const fields = codecString.split('.')
  if (fields.length < 4) return null
  return `${fields[1]}.${fields[3]}`
}

// The two 601 matrices have the same coefficients.
const MATRIX_CLASS: Record<string, string> = { bt470bg: 'bt601', smpte170m: 'bt601' }
const matrixClass = (matrix: string) => MATRIX_CLASS[matrix] ?? matrix

// A copied frame keeps the colours it was encoded with, so a stated difference
// in how its numbers turn into colours (the matrix and the value range) would
// show as a jump at every join. Primaries and transfer curve differ by little
// and players hardly apply them, so they are not held against a stream. A
// source that states nothing is given the benefit of the doubt.
function colorsDiffer(source: StreamColor | null | undefined, target: StreamColor | null | undefined): boolean {
  if (!source || !target) return false
  const range = source.fullRange != null && target.fullRange != null && source.fullRange !== target.fullRange
  const matrix =
    source.matrix != null &&
    target.matrix != null &&
    matrixClass(source.matrix) !== matrixClass(target.matrix)
  return range || matrix
}

export interface BlockerOptions {
  // Do not hold a stated colour difference against the source.
  ignoreColor?: boolean
}

function sameParams(source: SourceStream, target: TargetStream): boolean {
  if (target.codec === 'vp8') return true
  if (target.codec === 'avc') {
    // Parameter sets may differ: each gets a number of its own in the output.
    return avcCompatible(source.description, target.description)
  }
  if (target.codec === 'vp9' || target.codec === 'av1') {
    if (!source.codecString) return false
    const ours = profileAndDepth(source.codecString)
    const theirs = profileAndDepth(target.codecString)
    return ours !== null && ours === theirs
  }
  return sameBytes(source.description, target.description)
}

// Every reason a source stream cannot be mixed into the output as it is.
export function copyBlockers(
  source: SourceStream | null,
  target: TargetStream,
  options: BlockerOptions = {},
): CopyBlocker[] {
  if (!source) return ['no-video']
  if (source.codec !== target.codec) return ['codec']
  const found: CopyBlocker[] = []
  if (source.rotation !== 0) found.push('rotation')
  if (source.width !== target.width || source.height !== target.height) found.push('size')
  if (!options.ignoreColor && colorsDiffer(source.color, target.color)) found.push('color')
  if (!sameParams(source, target)) found.push('params')
  return found
}

// The first reason, or null when the stream can be copied.
export function copyBlocker(
  source: SourceStream | null,
  target: TargetStream,
  options: BlockerOptions = {},
): CopyBlocker | null {
  return copyBlockers(source, target, options)[0] ?? null
}
