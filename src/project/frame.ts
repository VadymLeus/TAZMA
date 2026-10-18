// src/project/frame.ts
import type { Clip, Source } from './types.ts'

export interface FrameSize {
  width: number
  height: number
}

export const DEFAULT_FRAME: FrameSize = { width: 1280, height: 720 }

// The project frame follows the first clip; other files are fitted into it.
export function frameSize(clips: Clip[], sources: Source[]): FrameSize {
  const first = clips[0]
  const video = first
    ? sources.find((s) => s.id === first.sourceId)?.info.video
    : null
  if (!video || !(video.width > 0) || !(video.height > 0)) return DEFAULT_FRAME
  return { width: video.width, height: video.height }
}
