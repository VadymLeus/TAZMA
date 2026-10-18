// src/export/audio.ts

export interface TrimWindow {
  frameOffset: number
  frameCount: number
  timestamp: number
}

// Which frames of a decoded audio block fall into a clip [clipStart, clipEnd)
// (source seconds), and where they land on the output timeline.
export function trimWindow(
  blockStart: number,
  frames: number,
  sampleRate: number,
  clipStart: number,
  clipEnd: number,
  offset: number,
): TrimWindow | null {
  const first = Math.max(0, Math.round((clipStart - blockStart) * sampleRate))
  const last = Math.min(frames, Math.round((clipEnd - blockStart) * sampleRate))
  if (last - first <= 0) return null
  return {
    frameOffset: first,
    frameCount: last - first,
    timestamp: offset + (blockStart + first / sampleRate - clipStart),
  }
}

export interface SilenceChunk {
  timestamp: number
  frames: number
}

// Splits [from, to) of the output timeline into silent blocks; boundaries are
// whole frames, so consecutive blocks join without gaps or overlaps.
export function silenceChunks(
  from: number,
  to: number,
  sampleRate: number,
  chunkFrames = sampleRate,
): SilenceChunk[] {
  const first = Math.round(from * sampleRate)
  const last = Math.round(to * sampleRate)
  const chunks: SilenceChunk[] = []
  for (let start = first; start < last; start += chunkFrames) {
    const end = Math.min(start + chunkFrames, last)
    chunks.push({ timestamp: start / sampleRate, frames: end - start })
  }
  return chunks
}
