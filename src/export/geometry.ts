// src/export/geometry.ts
import type { FrameSize } from '../project/frame.ts'

export const HEIGHT_OPTIONS = [1080, 720, 480, 360]

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)

// Encoders want even dimensions. A null height keeps the project frame.
export function outputSize(frame: FrameSize, height: number | null): FrameSize {
  if (!height || height <= 0) {
    return { width: even(frame.width), height: even(frame.height) }
  }
  const h = even(height)
  return { width: even(Math.round((h * frame.width) / frame.height)), height: h }
}

// Only downscaling is offered: it keeps the comparison between exports honest.
export function heightChoices(frame: FrameSize): number[] {
  return HEIGHT_OPTIONS.filter((height) => height < frame.height)
}
