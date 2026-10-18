// src/project/timeline.ts
import type { Clip } from './types.ts'

export const MIN_CLIP = 0.05
const END_MARGIN = 0.03

export interface Location {
  index: number
  offset: number
}

export type PlaybackStep =
  | { kind: 'play'; playhead: number }
  | { kind: 'advance'; index: number; contiguous: boolean }
  | { kind: 'end' }

export function clipLength(clip: Clip): number {
  return clip.end - clip.start
}

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((sum, clip) => sum + clipLength(clip), 0)
}

export function clipStart(clips: Clip[], index: number): number {
  let start = 0
  for (let i = 0; i < index; i++) start += clipLength(clips[i])
  return start
}

export function locate(clips: Clip[], time: number): Location | null {
  if (clips.length === 0) return null
  const total = timelineDuration(clips)
  const t = Math.min(Math.max(time, 0), total)
  let start = 0
  for (let index = 0; index < clips.length; index++) {
    const length = clipLength(clips[index])
    if (t < start + length) return { index, offset: t - start }
    start += length
  }
  const last = clips.length - 1
  return { index: last, offset: clipLength(clips[last]) }
}

export function splitAt(
  clips: Clip[],
  time: number,
  newId: string,
): { clips: Clip[]; rightId: string } | null {
  const location = locate(clips, time)
  if (!location) return null
  const clip = clips[location.index]
  if (
    location.offset < MIN_CLIP ||
    clipLength(clip) - location.offset < MIN_CLIP
  ) {
    return null
  }
  const cut = clip.start + location.offset
  const left: Clip = { ...clip, end: cut }
  const right: Clip = { id: newId, sourceId: clip.sourceId, start: cut, end: clip.end }
  return {
    clips: [
      ...clips.slice(0, location.index),
      left,
      right,
      ...clips.slice(location.index + 1),
    ],
    rightId: newId,
  }
}

export function canSplit(clips: Clip[], time: number): boolean {
  return splitAt(clips, time, '') !== null
}

export function removeClip(clips: Clip[], id: string): Clip[] {
  return clips.filter((clip) => clip.id !== id)
}

export function removeSourceClips(clips: Clip[], sourceId: string): Clip[] {
  return clips.filter((clip) => clip.sourceId !== sourceId)
}

export function moveClip(clips: Clip[], id: string, delta: -1 | 1): Clip[] {
  const from = clips.findIndex((clip) => clip.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= clips.length) return clips
  const next = [...clips]
  next[from] = clips[to]
  next[to] = clips[from]
  return next
}

// One playback tick: where the playhead is, or what to do at a clip's end.
// Neighbouring pieces of the same file (after a split) play on without a seek.
export function playbackStep(
  clips: Clip[],
  index: number,
  sourceTime: number,
): PlaybackStep {
  const clip = clips[index]
  if (sourceTime < clip.end - END_MARGIN) {
    return {
      kind: 'play',
      playhead: clipStart(clips, index) + Math.max(0, sourceTime - clip.start),
    }
  }
  const next = clips[index + 1]
  if (!next) return { kind: 'end' }
  const contiguous =
    next.sourceId === clip.sourceId && Math.abs(next.start - clip.end) < 1e-6
  return { kind: 'advance', index: index + 1, contiguous }
}
