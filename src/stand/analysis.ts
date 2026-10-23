// src/stand/analysis.ts
import { optimalInterval, wasteRate } from '../resume/interval.ts'
import { counted, pairedRatios, summaryOf } from './aggregate.ts'
import { exactOptimum, expectedTime } from './model.ts'
import type { RunRecord } from './record.ts'
import type { Condition } from './series.ts'
import type { Summary } from './stats.ts'
import { summarize } from './stats.ts'

export const REFERENCE = 'ref'

export interface IntervalRow {
  // The condition with cuts and the one without, for this part length.
  condition: string
  quiet: string | null
  label: string
  // Length of a part in timeline seconds, and in seconds of work.
  interval: number
  work: number
  n: number
  // Total time of the runs with cuts, in seconds, and the waste over the plain
  // export (ratio of the paired runs minus one).
  wall: Summary | null
  waste: Summary | null
  // The mean waste and its standard error, which is what the model predicts
  // (the median of a skewed waste lies below it).
  wasteMean: number | null
  wasteSe: number | null
  crashes: Summary | null
  // What the journal costs without any cut: the paired ratio minus one.
  overhead: Summary | null
  // Checkpoints a run without cuts wrote.
  commits: number | null
  // What the model gives for this row: Young's t_c/τ + τ/(2M) with the cost of
  // a checkpoint as the export reports it, and Daly's exact result with the
  // cost the extra time of the runs without cuts shows, and the restart.
  young: number | null
  exact: number | null
}

// The extra time a journal costs, told apart into what it costs once and what
// each checkpoint costs, in seconds.
export interface CheckpointFit {
  fixed: number
  perCommit: number
}

export interface IntervalAnalysis {
  // Seconds an export without journal or cuts takes, and the speed it had
  // (seconds of timeline per second).
  plain: number
  speed: number
  // Mean time between cuts, seconds.
  mtbf: number
  // Cost of a checkpoint as the export reports it, and as the extra time of
  // the runs without cuts shows it; seconds. Null when not measured.
  cost: number | null
  effective: CheckpointFit | null
  restart: number | null
  rows: IntervalRow[]
  // Young's interval for the reported cost, for the effective one, and the
  // exact one of the model, in seconds of work and of timeline.
  young: Interval | null
  youngEffective: Interval | null
  exact: Interval | null
  // The row with the least mean waste measured.
  best: string | null
  // How the row nearest to the formula's interval compares with the best one,
  // run by run within a round.
  verdict: Verdict | null
}

export interface Verdict {
  formula: string
  best: string
  // The formula's row minus the best row, in waste, with its standard error
  // and the rounds it rests on. Zero when they are the same row.
  difference: number
  se: number
  n: number
}

export interface Interval {
  work: number
  timeline: number
}

const seconds = (ms: number) => ms / 1000
const inTimeline = (work: number, speed: number): Interval => ({ work, timeline: work * speed })

function scaled(summary: Summary | null, factor: number): Summary | null {
  if (!summary) return null
  return {
    n: summary.n,
    min: summary.min * factor,
    max: summary.max * factor,
    mean: summary.mean * factor,
    median: summary.median * factor,
    q1: summary.q1 * factor,
    q3: summary.q3 * factor,
    sd: summary.sd * factor,
  }
}

function medianOf(records: RunRecord[], key: 'checkpointMs' | 'openMs' | 'restartMs'): number | null {
  const values = [...counted(records).values()]
    .flat()
    .map((record) => record[key])
    .filter((value): value is number => typeof value === 'number')
  return summarize(values)?.median ?? null
}

// A line through the extra time of runs against the number of checkpoints
// they wrote. With one count only, every checkpoint gets the same share and
// nothing is fixed; a line that falls is read as "not resolvable" and leaves
// the checkpoints free.
export function fitCheckpoint(points: { commits: number; extra: number }[]): CheckpointFit | null {
  const usable = points.filter((point) => point.commits > 0 && Number.isFinite(point.extra))
  if (usable.length === 0) return null
  const n = usable.length
  const meanX = usable.reduce((sum, point) => sum + point.commits, 0) / n
  const meanY = usable.reduce((sum, point) => sum + point.extra, 0) / n
  const spread = usable.reduce((sum, point) => sum + (point.commits - meanX) ** 2, 0)
  if (spread === 0) return { fixed: 0, perCommit: Math.max(0, meanY / meanX) }
  const slope = usable.reduce((sum, point) => sum + (point.commits - meanX) * (point.extra - meanY), 0) / spread
  if (slope <= 0) return { fixed: Math.max(0, meanY), perCommit: 0 }
  return { fixed: Math.max(0, meanY - slope * meanX), perCommit: slope }
}

// The extra seconds of every counted run without cuts over the plain export of
// its round, with the checkpoints it wrote.
function quietPoints(records: RunRecord[], conditions: Condition[]): { commits: number; extra: number }[] {
  const groups = counted(records)
  const plain = new Map((groups.get(REFERENCE) ?? []).map((record) => [record.round, record.wallMs]))
  const points: { commits: number; extra: number }[] = []
  for (const condition of conditions) {
    if (condition.interval === undefined || condition.crashMeanMs !== undefined) continue
    for (const record of groups.get(condition.id) ?? []) {
      const base = plain.get(record.round)
      if (base === undefined || typeof record.commits !== 'number') continue
      points.push({ commits: record.commits, extra: seconds(record.wallMs - base) })
    }
  }
  return points
}

function wasteByRound(records: RunRecord[], condition: string): Map<number, number> {
  const plain = new Map((counted(records).get(REFERENCE) ?? []).map((record) => [record.round, record.wallMs]))
  const found = new Map<number, number>()
  for (const record of counted(records).get(condition) ?? []) {
    const base = plain.get(record.round)
    if (base !== undefined && base > 0) found.set(record.round, record.wallMs / base - 1)
  }
  return found
}

const standardError = (summary: Summary | null) => (summary && summary.n > 1 ? summary.sd / Math.sqrt(summary.n) : null)

function compare(records: RunRecord[], formula: string, best: string): Verdict | null {
  if (formula === best) return { formula, best, difference: 0, se: 0, n: wasteByRound(records, best).size }
  const a = wasteByRound(records, formula)
  const b = wasteByRound(records, best)
  const diffs = [...a].filter(([round]) => b.has(round)).map(([round, value]) => value - (b.get(round) as number))
  const summary = summarize(diffs)
  if (!summary) return null
  return { formula, best, difference: summary.mean, se: standardError(summary) ?? 0, n: summary.n }
}

// Reads a sweep of the checkpoint interval against the model. Null until the
// plain export has a counted run to measure against.
export function analyzeInterval(records: RunRecord[], conditions: Condition[], mtbfMs: number): IntervalAnalysis | null {
  const plainWall = summaryOf(records, REFERENCE, 'wallMs')
  const duration = summaryOf(records, REFERENCE, 'duration')
  if (!plainWall || !duration || !(plainWall.median > 0) || !(duration.median > 0)) return null
  const plain = seconds(plainWall.median)
  const speed = duration.median / plain
  const mtbf = seconds(mtbfMs)
  const quietIds = new Set(conditions.filter((c) => c.interval !== undefined && c.crashMeanMs === undefined).map((c) => c.id))
  const journaled = records.filter((record) => record.condition !== REFERENCE)
  const quiet = journaled.filter((record) => quietIds.has(record.condition))
  // Closing a part and opening the next, as the export reports them.
  const closingMs = medianOf(quiet, 'checkpointMs') ?? medianOf(journaled, 'checkpointMs')
  const openingMs = medianOf(quiet, 'openMs') ?? medianOf(journaled, 'openMs')
  const costMs = closingMs === null ? null : closingMs + (openingMs ?? 0)
  const restartMs = medianOf(
    journaled.filter((record) => !quietIds.has(record.condition)),
    'restartMs',
  )
  const cost = costMs === null ? null : seconds(costMs)
  const restart = restartMs === null ? null : seconds(restartMs)
  const effective = fitCheckpoint(quietPoints(records, conditions))
  const effectiveCost = effective && effective.perCommit > 0 ? effective.perCommit : cost
  const fixed = effective?.fixed ?? 0

  const rows: IntervalRow[] = conditions
    .filter((condition): condition is Condition & { interval: number } => condition.interval !== undefined && condition.crashMeanMs !== undefined)
    .map((condition) => {
      const twin = conditions.find((other) => other.interval === condition.interval && other.crashMeanMs === undefined)
      const work = condition.interval / speed
      const wall = summaryOf(records, condition.id, 'wallMs')
      const waste = summarize(pairedRatios(records, condition.id, REFERENCE, 'wallMs').map((ratio) => ratio - 1))
      return {
        condition: condition.id,
        quiet: twin?.id ?? null,
        label: condition.label,
        interval: condition.interval,
        work,
        n: wall?.n ?? 0,
        wall: scaled(wall, 0.001),
        waste,
        wasteMean: waste?.mean ?? null,
        wasteSe: standardError(waste),
        crashes: summaryOf(records, condition.id, 'crashes'),
        overhead: twin ? summarize(pairedRatios(records, twin.id, REFERENCE, 'wallMs').map((ratio) => ratio - 1)) : null,
        commits: twin ? (summaryOf(records, twin.id, 'commits')?.median ?? null) : null,
        young: cost === null ? null : wasteRate(cost, work, mtbf),
        exact:
          effectiveCost === null
            ? null
            : expectedTime({ work: plain + fixed, cost: effectiveCost, interval: work, mtbf, restart: restart ?? 0 }) / plain - 1,
      }
    })
    .sort((a, b) => a.interval - b.interval)

  const measured = rows.filter((row) => row.wasteMean !== null)
  const best = measured.length > 0 ? measured.reduce((a, b) => ((b.wasteMean as number) < (a.wasteMean as number) ? b : a)) : null
  const target = effectiveCost === null ? null : optimalInterval(effectiveCost, mtbf) * speed
  const nearest =
    target === null || measured.length === 0
      ? null
      : measured.reduce((a, b) => (Math.abs(Math.log(b.interval / target)) < Math.abs(Math.log(a.interval / target)) ? b : a))
  return {
    plain,
    speed,
    mtbf,
    cost,
    effective,
    restart,
    rows,
    young: cost === null ? null : inTimeline(optimalInterval(cost, mtbf), speed),
    youngEffective: effectiveCost === null ? null : inTimeline(optimalInterval(effectiveCost, mtbf), speed),
    exact:
      effectiveCost === null
        ? null
        : inTimeline(exactOptimum({ work: plain + fixed, cost: effectiveCost, mtbf, restart: restart ?? 0 }), speed),
    best: best?.condition ?? null,
    verdict: best && nearest ? compare(records, nearest.condition, best.condition) : null,
  }
}
