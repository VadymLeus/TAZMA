// src/export/plan.ts
import { clipLength } from '../project/timeline.ts'
import type { Clip } from '../project/types.ts'

// A clip placed on the output timeline.
export interface Segment {
  clip: Clip
  start: number
  end: number
  offset: number
  length: number
}

export function buildSegments(clips: Clip[]): Segment[] {
  const segments: Segment[] = []
  let offset = 0
  for (const clip of clips) {
    const length = clipLength(clip)
    segments.push({ clip, start: clip.start, end: clip.end, offset, length })
    offset += length
  }
  return segments
}
