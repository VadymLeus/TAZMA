// src/export/gifTicks.ts

// Frames of a GIF sit on an even grid. Tick k shows the picture at its start
// and lasts until the start of the next one; the last tick ends with the video.
export function tickCount(total: number, fps: number): number {
  return Math.max(1, Math.round(total * fps))
}

export function tickStart(index: number, fps: number): number {
  return index / fps
}

export function tickEnd(index: number, count: number, total: number, fps: number): number {
  return index + 1 < count ? (index + 1) / fps : total
}

const MIN_DELAY = 2

// Delays are whole hundredths of a second. Rounding the running end instead
// of each length keeps the whole animation as long as the video; browsers
// show anything under 2 hundredths as 10, so no frame is made shorter.
export function tickDelay(index: number, count: number, total: number, fps: number): number {
  const end = Math.round(tickEnd(index, count, total, fps) * 100)
  const start = index === 0 ? 0 : Math.round(tickEnd(index - 1, count, total, fps) * 100)
  return Math.max(MIN_DELAY, end - start)
}
