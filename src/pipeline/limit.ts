// src/pipeline/limit.ts

// Raw 8-bit 4:2:0 picture: one byte of luma and half a byte of chroma a pixel.
export const BYTES_PER_PIXEL = 1.5
export const MIN_LIMIT = 1
export const MAX_LIMIT = 512

export function frameBytes(width: number, height: number): number {
  return Math.round(BYTES_PER_PIXEL * width * height)
}

// Besides the frames that wait between decoder and encoder, the export always
// holds two pictures of 4 bytes a pixel at the encoder's entrance: Mediabunny's
// CanvasSource makes a VideoFrame from the canvas, and toVideoFrame() makes
// another one from it for VideoEncoder.encode() while the first is still open.
// They are not under the limit, so the budget has to cover them first. They
// may share their pixels, but the frame counter counts both, and so do we.
// Measured: peak = (peakFrames - 2) * frameBytes + two such pictures, in every
// run on two frame sizes and two encoders.
export const ENCODER_FRAMES = 2
export const ENCODER_BYTES_PER_PIXEL = 4

export function fixedBytes(width: number, height: number): number {
  return ENCODER_FRAMES * ENCODER_BYTES_PER_PIXEL * width * height
}

// N_mem: how many frames fit into the memory budget once the fixed part is
// paid. A budget that does not even cover one frame gives the minimum.
export function memoryLimit(budgetBytes: number, width: number, height: number): number {
  const size = frameBytes(width, height)
  if (!(size > 0) || !(budgetBytes > 0)) return MIN_LIMIT
  return Math.max(MIN_LIMIT, Math.floor((budgetBytes - fixedBytes(width, height)) / size))
}

// N_perf: how many frames keep the slowest stage busy. By Little's law a
// stage that passes `rate` frames a second, fed through a pipeline that takes
// `latency` seconds for one frame when nothing waits, needs rate * latency
// frames in flight; `margin` is the reserve for uneven frame times.
export function throughputLimit(rate: number, latency: number, margin: number): number {
  if (!(rate > 0) || !(latency > 0)) return MIN_LIMIT
  return Math.max(MIN_LIMIT, Math.ceil(rate * latency * (1 + Math.max(0, margin))))
}

// N = min(N_mem, N_perf), kept inside the hard bounds.
export function combineLimits(byMemory: number, byThroughput: number): number {
  return Math.max(MIN_LIMIT, Math.min(byMemory, byThroughput, MAX_LIMIT))
}
