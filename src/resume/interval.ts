// src/resume/interval.ts

export const MIN_SEGMENT_SECONDS = 2
export const MAX_SEGMENT_SECONDS = 600
export const DEFAULT_MTBF_MINUTES = 60

// What is assumed of the cost of one checkpoint (seconds) and of the speed of
// the export (seconds of timeline per second of work) until an export of this
// browser has been measured.
export const DEFAULT_COST = 0.06
export const DEFAULT_SPEED = 2

function check(name: string, value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`${name} має бути додатним числом.`)
}

// The interval between checkpoints, in seconds of work, that costs least: a
// checkpoint takes `cost` seconds, and the export is cut short once in `mtbf`
// seconds of work on average (Young's first-order formula, τ = √(2·t_c·M)).
export function optimalInterval(cost: number, mtbf: number): number {
  check('Ціна точки', cost)
  check('Час між обривами', mtbf)
  return Math.sqrt(2 * cost * mtbf)
}

// The share of the work that goes to checkpoints and to doing again what the
// last cut lost: t_c/τ + τ/(2M).
export function wasteRate(cost: number, interval: number, mtbf: number): number {
  check('Ціна точки', cost)
  check('Інтервал', interval)
  check('Час між обривами', mtbf)
  return cost / interval + interval / (2 * mtbf)
}

export interface IntervalPlan {
  // The interval in seconds of work, as the formula gives it.
  work: number
  // The length of a part of the journal, in seconds of timeline, that comes
  // closest to it within the limits.
  segment: number
  // What the part length costs, as a share of the work.
  waste: number
  // The formula's answer lay outside the limits and was brought into them.
  clamped: boolean
}

export interface IntervalInput {
  cost: number
  mtbf: number
  speed: number
}

export function planInterval({ cost, mtbf, speed }: IntervalInput): IntervalPlan {
  check('Швидкість', speed)
  const work = optimalInterval(cost, mtbf)
  const wanted = work * speed
  const segment = Math.min(MAX_SEGMENT_SECONDS, Math.max(MIN_SEGMENT_SECONDS, Math.round(wanted)))
  return {
    work,
    segment,
    waste: wasteRate(cost, segment / speed, mtbf),
    clamped: segment !== Math.round(wanted),
  }
}

const toNumber = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text.trim().replace(',', '.')))

// The length of a part typed by the person, in seconds; null if it is not a
// number within the limits.
export function parseSegmentSeconds(text: string): number | null {
  const value = toNumber(text)
  return Number.isFinite(value) && value >= MIN_SEGMENT_SECONDS && value <= MAX_SEGMENT_SECONDS ? value : null
}

const MAX_MINUTES = 100_000

// The time between cuts typed by the person, in minutes; null if it is not a
// positive number.
export function parseMinutes(text: string): number | null {
  const value = toNumber(text)
  return Number.isFinite(value) && value > 0 && value <= MAX_MINUTES ? value : null
}
