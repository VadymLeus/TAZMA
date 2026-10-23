// src/resume/recommend.ts
import type { JournalReport } from '../export/types.ts'
import {
  DEFAULT_COST,
  DEFAULT_MTBF_MINUTES,
  DEFAULT_SPEED,
  planInterval,
  wasteRate,
} from './interval.ts'
import type { IntervalPlan } from './interval.ts'
import { measurementOf } from './measure.ts'
import type { Measurement } from './measure.ts'

// The part length the formula gives, and what it was worked out from.
export interface Suggestion {
  plan: IntervalPlan
  // Seconds a checkpoint costs, and seconds of timeline per second of work.
  cost: number
  speed: number
  // The numbers come from an export of this browser, not from the defaults.
  measured: boolean
  mtbfMinutes: number
}

const MINUTE = 60

// The part length for an export that is cut short once in `mtbfMinutes` of
// work. Null for a time between cuts that is not a positive number.
export function suggestSegment(mtbfMinutes: number, measured: Measurement | null): Suggestion | null {
  if (!(mtbfMinutes > 0) || !Number.isFinite(mtbfMinutes)) return null
  const cost = measured?.cost ?? DEFAULT_COST
  const speed = measured?.speed ?? DEFAULT_SPEED
  const plan = planInterval({ cost, mtbf: mtbfMinutes * MINUTE, speed })
  return { plan, cost, speed, measured: measured !== null, mtbfMinutes }
}

export interface Recommendation extends Suggestion {
  // The share of the work the part length of this export costs, as the
  // formula counts it.
  usedWaste: number
}

// What an export through the journal says of its own part length: the length
// the formula would give from the cost it measured, and what both lengths cost.
export function recommendationOf(
  report: JournalReport,
  duration: number,
  mtbfMinutes = DEFAULT_MTBF_MINUTES,
): Recommendation | null {
  const measured = measurementOf(report, duration)
  if (!measured) return null
  const suggestion = suggestSegment(mtbfMinutes, measured)
  if (!suggestion || !(report.segmentSeconds > 0)) return null
  const usedWaste = wasteRate(measured.cost, report.segmentSeconds / measured.speed, mtbfMinutes * MINUTE)
  return { ...suggestion, usedWaste }
}
