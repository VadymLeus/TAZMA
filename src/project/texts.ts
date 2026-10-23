// src/project/texts.ts
import type { TextItem } from './types.ts'

export const MIN_TEXT = 0.1
export const MIN_SIZE = 0.02
export const MAX_SIZE = 0.3
const DEFAULT_LENGTH = 3

export type TextPatch = Partial<Omit<TextItem, 'id'>>

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high)
const finite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

// Keeps a caption inside the timeline and its numbers in a sane range.
export function normalizeText(text: TextItem, total: number): TextItem {
  const start = clamp(finite(text.start, 0), 0, Math.max(0, total - MIN_TEXT))
  const end = Math.min(Math.max(finite(text.end, total), start + MIN_TEXT), total)
  return {
    ...text,
    start,
    end,
    x: clamp(finite(text.x, 0.5), 0, 1),
    y: clamp(finite(text.y, 0.85), 0, 1),
    size: clamp(finite(text.size, 0.07), MIN_SIZE, MAX_SIZE),
  }
}

export function newText(id: string, time: number, total: number): TextItem | null {
  if (total < MIN_TEXT) return null
  const start = clamp(time, 0, total - MIN_TEXT)
  return normalizeText(
    {
      id,
      text: 'Текст',
      start,
      end: start + DEFAULT_LENGTH,
      x: 0.5,
      y: 0.85,
      size: 0.07,
      color: '#ffffff',
    },
    total,
  )
}

export function updateText(
  texts: TextItem[],
  id: string,
  patch: TextPatch,
  total: number,
): TextItem[] {
  return texts.map((text) =>
    text.id === id ? normalizeText({ ...text, ...patch }, total) : text,
  )
}

export function removeText(texts: TextItem[], id: string): TextItem[] {
  return texts.filter((text) => text.id !== id)
}

export function textsAt(texts: TextItem[], time: number): TextItem[] {
  return texts.filter((text) => time >= text.start && time < text.end)
}

// After the timeline got shorter: cut captions at the new end, drop those past it.
export function fitTexts(texts: TextItem[], total: number): TextItem[] {
  const kept: TextItem[] = []
  for (const text of texts) {
    if (text.start > total - MIN_TEXT + 1e-9) continue
    kept.push(text.end > total ? { ...text, end: total } : text)
  }
  const same = kept.length === texts.length && kept.every((t, i) => t === texts[i])
  return same ? texts : kept
}

// Puts captions that overlap in time on separate rows of the text track.
export function assignLanes(texts: TextItem[]): {
  lane: Map<string, number>
  count: number
} {
  const laneEnds: number[] = []
  const lane = new Map<string, number>()
  for (const text of [...texts].sort((a, b) => a.start - b.start)) {
    let index = laneEnds.findIndex((end) => end <= text.start + 1e-9)
    if (index < 0) {
      index = laneEnds.length
      laneEnds.push(text.end)
    } else {
      laneEnds[index] = text.end
    }
    lane.set(text.id, index)
  }
  return { lane, count: Math.max(1, laneEnds.length) }
}
