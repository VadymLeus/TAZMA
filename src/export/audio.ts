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

// How far from the end of a clip a decoder may fail and leave the rest of the
// clip without sound, in seconds. A file that was cut off or not closed
// properly often has one broken packet at the very end.
export const AUDIO_TAIL_SLACK = 2

// Whether a failure of the audio decoder is at the tail of the clip: the sound
// decoded so far (source seconds, null if none) reaches almost to the end.
export function failureAtTail(
  decodedEnd: number | null,
  clipEnd: number,
  slack = AUDIO_TAIL_SLACK,
): boolean {
  return decodedEnd !== null && decodedEnd >= clipEnd - slack
}
