// src/pipeline/limit.ts

// Raw 8-bit 4:2:0 picture: one byte of luma and half a byte of chroma a pixel.
export const BYTES_PER_PIXEL = 1.5
export const MIN_LIMIT = 1
export const MAX_LIMIT = 512

export function frameBytes(width: number, height: number): number {
  return Math.round(BYTES_PER_PIXEL * width * height)
}

// N_mem: how many frames fit into the memory budget.
export function memoryLimit(budgetBytes: number, width: number, height: number): number {
  const size = frameBytes(width, height)
  if (!(size > 0) || !(budgetBytes > 0)) return MIN_LIMIT
  return Math.max(MIN_LIMIT, Math.floor(budgetBytes / size))
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
