// src/gif/timing.ts

// Browsers show a GIF frame with a delay of 10 ms or less for 100 ms, so the
// clip made from a GIF does the same and plays at the speed people know.
const TOO_SHORT_MICRO = 10_000
export const DEFAULT_DELAY_MICRO = 100_000

// A GIF with one frame is a picture; as a clip it lasts this long.
export const STILL_MICRO = 3_000_000

// How long a frame is shown, in whole microseconds, as the decoder reports it.
export function frameMicro(delay: number | null | undefined, onlyFrame = false): number {
  const micro =
    delay == null || !Number.isFinite(delay) || delay <= TOO_SHORT_MICRO
      ? DEFAULT_DELAY_MICRO
      : Math.round(delay)
  return onlyFrame ? Math.max(micro, STILL_MICRO) : micro
}

export interface GifFrameTime {
  start: number
  duration: number
}

// Start and length of every frame in seconds. The delays are added up as
// integers so that a long file does not drift.
export function gifTimeline(delays: (number | null | undefined)[]): GifFrameTime[] {
  const times: GifFrameTime[] = []
  let elapsed = 0
  for (const delay of delays) {
    const micro = frameMicro(delay, delays.length === 1)
    times.push({ start: elapsed / 1e6, duration: micro / 1e6 })
    elapsed += micro
  }
  return times
}

export function isGif(file: { name: string; type: string }): boolean {
  return file.type === 'image/gif' || /\.gif$/i.test(file.name)
}
