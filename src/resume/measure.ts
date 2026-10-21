// src/resume/measure.ts
import type { ExportMode, JournalReport } from '../export/types.ts'

// What an export through the journal showed about its checkpoints: the cost of
// one (seconds) and the speed (seconds of timeline per second of video work).
export interface Measurement {
  cost: number
  speed: number
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'tazma.checkpoints.v1'

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

// The measurement of an export, or null when it closed no part or did no video
// work (an export that only built the file from the journal).
export function measurementOf(report: JournalReport, duration: number): Measurement | null {
  const covered = duration - report.resumedFrom
  if (report.commits <= 0 || !(report.videoMs > 0) || !(covered > 0)) return null
  const cost = report.checkpointMs / report.commits / 1000
  const speed = covered / (report.videoMs / 1000)
  return isPositive(cost) && isPositive(speed) ? { cost, speed } : null
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readAll(storage: StorageLike | null): Partial<Record<ExportMode, Measurement>> {
  try {
    const text = storage?.getItem(KEY)
    if (!text) return {}
    const value = JSON.parse(text) as Record<string, { cost?: unknown; speed?: unknown }>
    const found: Partial<Record<ExportMode, Measurement>> = {}
    for (const mode of ['full', 'selective'] as const) {
      const item = value?.[mode]
      if (item && isPositive(item.cost) && isPositive(item.speed)) found[mode] = { cost: item.cost, speed: item.speed }
    }
    return found
  } catch {
    return {}
  }
}

// The last measurement of the mode in this browser, if any. Kept apart for
// each mode: copying packets and encoding frames run at very different speeds.
export function loadMeasurement(mode: ExportMode, storage: StorageLike | null = browserStorage()): Measurement | null {
  return readAll(storage)[mode] ?? null
}

export function saveMeasurement(
  mode: ExportMode,
  measurement: Measurement,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ ...readAll(storage), [mode]: measurement }))
  } catch {
    // The storage may be full or blocked; the next export measures again.
  }
}
