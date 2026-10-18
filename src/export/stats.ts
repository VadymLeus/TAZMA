// src/export/stats.ts
import type { ExportResult } from './types.ts'

// Seconds left, or null while there is too little progress to say anything.
export function estimateRemaining(
  done: number,
  total: number,
  elapsedMs: number,
): number | null {
  if (!(done > 0) || !(total > 0) || elapsedMs < 400) return null
  const rate = done / elapsedMs
  return Math.max(0, (total - done) / rate / 1000)
}

export function formatRemaining(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds))
  if (whole < 60) return `≈ ${whole} с`
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return rest === 0 ? `≈ ${minutes} хв` : `≈ ${minutes} хв ${rest} с`
}

export interface ResultSpeed {
  framesPerSecond: number
  realtime: number
}

export function resultSpeed(
  result: Pick<ExportResult, 'frames' | 'duration' | 'elapsedMs'>,
): ResultSpeed {
  const seconds = Math.max(result.elapsedMs, 1) / 1000
  return {
    framesPerSecond: result.frames / seconds,
    realtime: result.duration / seconds,
  }
}
