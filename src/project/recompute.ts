// src/project/recompute.ts
import { isActive } from './effects.ts'
import { clipLength, timelineDuration } from './timeline.ts'
import type { Clip, TextItem } from './types.ts'

export interface Range {
  start: number
  end: number
}

const EPS = 1e-6

// Timeline spans that cannot be copied as is: clips with an effect and the
// time covered by captions. Sorted, with overlapping spans merged.
export function recomputeRanges(clips: Clip[], texts: TextItem[]): Range[] {
  const total = timelineDuration(clips)
  const raw: Range[] = []

  let position = 0
  for (const clip of clips) {
    const length = clipLength(clip)
    if (isActive(clip.effect)) raw.push({ start: position, end: position + length })
    position += length
  }
  for (const text of texts) {
    const end = Math.min(text.end, total)
    if (end - text.start > EPS) raw.push({ start: text.start, end })
  }

  raw.sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const range of raw) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + EPS) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

export function rangesLength(ranges: Range[]): number {
  return ranges.reduce((sum, range) => sum + (range.end - range.start), 0)
}
