// src/stand/schedule.ts

export interface ScheduledRun {
  // Place in the whole schedule, from 0.
  index: number
  condition: string
  // Which pass over the conditions this run belongs to; warm-up runs are -1.
  round: number
  // A run that only warms the browser up and is left out of the figures.
  warmup: boolean
}

export interface ScheduleOptions {
  conditions: string[]
  repeats: number
  seed: number
  // Runs before the first round that are thrown away: the first export of a
  // page is slower than the ones after it.
  warmupRuns?: number
}

// A small seeded generator, so that a schedule can be told again exactly.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Every round runs each condition once, in an order drawn anew each time, so
// that a slow drift of the machine (heat, other programs, disk cache) falls on
// all conditions alike instead of on the one that happened to run last. The
// same condition never runs twice in a row where there are several.
export function makeSchedule(options: ScheduleOptions): ScheduledRun[] {
  const { conditions, repeats, seed } = options
  const warmupRuns = options.warmupRuns ?? 0
  if (conditions.length === 0) throw new RangeError('Немає жодної умови.')
  if (new Set(conditions).size !== conditions.length) throw new RangeError('Умови не повинні повторюватись.')
  if (!Number.isInteger(repeats) || repeats < 1) throw new RangeError('Число повторів — ціле, не менше 1.')
  if (!Number.isInteger(warmupRuns) || warmupRuns < 0) throw new RangeError('Число прогрівальних прогонів — ціле, не менше 0.')

  const random = mulberry32(seed)
  const order = (previousLast: string | null): string[] => {
    const next = shuffled(conditions, random)
    if (conditions.length > 1 && next[0] === previousLast) [next[0], next[1]] = [next[1], next[0]]
    return next
  }

  const runs: ScheduledRun[] = []
  let last: string | null = null
  const push = (condition: string, round: number, warmup: boolean) => {
    runs.push({ index: runs.length, condition, round, warmup })
    last = condition
  }

  for (let done = 0; done < warmupRuns; ) {
    for (const condition of order(last)) {
      if (done >= warmupRuns) break
      push(condition, -1, true)
      done++
    }
  }
  for (let round = 0; round < repeats; round++) {
    for (const condition of order(last)) push(condition, round, false)
  }
  return runs
}
