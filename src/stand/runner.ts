// src/stand/runner.ts
import { failedRecord, recordOf } from './record.ts'
import type { RunMeta, RunRecord, StandResult } from './record.ts'
import type { ScheduledRun } from './schedule.ts'
import type { Condition, Series } from './series.ts'

export interface RunnerConfig {
  series: Series
  schedule: ScheduledRun[]
  // Runs one export of the condition and gives its result.
  execute: (condition: Condition, run: ScheduledRun) => Promise<StandResult>
  // Rest between runs, in milliseconds, so that the machine and the memory
  // settle before the next one.
  coolDownMs: number
  signal?: AbortSignal
  pause?: (ms: number) => Promise<void>
  now?: () => number
  onStart?: (run: ScheduledRun, condition: Condition, done: number, total: number) => void
  onRecord?: (record: RunRecord, done: number, total: number) => void
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Goes through the schedule run after run. A run that fails is written down as
// failed and the rest go on; a stop by the person ends the series with what is
// done so far.
export async function runSchedule(config: RunnerConfig): Promise<RunRecord[]> {
  const { series, schedule, execute, signal } = config
  const pause = config.pause ?? sleep
  const now = config.now ?? (() => performance.now())
  const records: RunRecord[] = []
  const conditions = new Map(series.conditions.map((condition) => [condition.id, condition]))

  for (const run of schedule) {
    if (signal?.aborted) break
    const condition = conditions.get(run.condition)
    if (!condition) throw new Error(`У серії немає умови «${run.condition}».`)
    config.onStart?.(run, condition, records.length, schedule.length)
    const meta: RunMeta = {
      series: series.id,
      condition: condition.id,
      label: condition.label,
      index: run.index,
      round: run.round,
      warmup: run.warmup,
    }
    const began = now()
    let record: RunRecord
    let result: StandResult | null = null
    try {
      result = await execute(condition, run)
      record = recordOf(meta, result, now() - began)
    } catch (error) {
      if (signal?.aborted) break
      record = failedRecord(meta, error, now() - began)
    } finally {
      await result?.release().catch(() => {})
    }
    records.push(record)
    config.onRecord?.(record, records.length, schedule.length)
    if (config.coolDownMs > 0 && run.index < schedule.length - 1 && !signal?.aborted) await pause(config.coolDownMs)
  }
  return records
}
