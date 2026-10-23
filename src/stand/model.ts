// src/stand/model.ts

// An export of `work` seconds that writes a checkpoint of `cost` seconds after
// every `interval` seconds of work. It is cut short at random moments, `mtbf`
// seconds apart on average (exponential gaps), and each restart takes
// `restart` seconds before the work goes on from the last checkpoint.
export interface ModelInput {
  work: number
  cost: number
  interval: number
  mtbf: number
  restart: number
}

function check(name: string, value: number, allowZero = false): void {
  const ok = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)
  if (!ok) throw new RangeError(`${name} має бути ${allowZero ? 'невід’ємним' : 'додатним'} числом.`)
}

function validate(input: ModelInput): void {
  check('Робота', input.work)
  check('Ціна точки', input.cost, true)
  check('Інтервал', input.interval)
  check('Час між обривами', input.mtbf)
  check('Ціна відновлення', input.restart, true)
}

// Expected total time with checkpoints and cuts (Daly's exact result for
// exponential failures, which also lets a cut fall inside a restart):
// M·e^{R/M}·(e^{(τ+t_c)/M} − 1)·W/τ.
export function expectedTime(input: ModelInput): number {
  validate(input)
  const { work, cost, interval, mtbf, restart } = input
  return mtbf * Math.exp(restart / mtbf) * Math.expm1((interval + cost) / mtbf) * (work / interval)
}

// What the cuts and the checkpoints add, as a share of the work.
export function expectedWaste(input: ModelInput): number {
  return expectedTime(input) / input.work - 1
}

// The interval that makes the expected time least, found numerically (the
// time is a single dip in τ, so a golden-section search finds it).
export function exactOptimum(input: Omit<ModelInput, 'interval'>): number {
  const at = (interval: number) => expectedTime({ ...input, interval })
  let low = Math.log(Math.max(input.cost, 1e-6) / 100)
  let high = Math.log(input.work)
  const ratio = (Math.sqrt(5) - 1) / 2
  let a = high - ratio * (high - low)
  let b = low + ratio * (high - low)
  let fa = at(Math.exp(a))
  let fb = at(Math.exp(b))
  for (let step = 0; step < 120 && high - low > 1e-9; step++) {
    if (fa < fb) {
      high = b
      b = a
      fb = fa
      a = high - ratio * (high - low)
      fa = at(Math.exp(a))
    } else {
      low = a
      a = b
      fa = fb
      b = low + ratio * (high - low)
      fb = at(Math.exp(b))
    }
  }
  return Math.exp((low + high) / 2)
}

export interface SimulatedRun {
  total: number
  crashes: number
}

// One export played out against a given list of gaps between cuts: each
// attempt lives for the next gap counted from its start, restart included.
// `nextGap` gives the gaps one by one.
export function simulateRun(input: ModelInput, nextGap: () => number, maxAttempts = 1_000_000): SimulatedRun {
  validate(input)
  const { work, cost, interval, restart } = input
  let committed = 0
  let total = 0
  let crashes = 0
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const gap = nextGap()
    let used = attempt === 0 ? 0 : restart
    if (used <= gap) {
      while (committed < work) {
        const part = Math.min(interval, work - committed)
        if (used + part + cost > gap) break
        used += part + cost
        committed += part
      }
      if (committed >= work) return { total: total + used, crashes }
    }
    total += gap
    crashes++
  }
  throw new Error('Експорт не завершився за відведену кількість спроб.')
}

// The mean total time over many plays, each against its own gaps.
export function simulatedMean(input: ModelInput, gapsFor: (play: number) => () => number, plays: number): number {
  let sum = 0
  for (let play = 0; play < plays; play++) sum += simulateRun(input, gapsFor(play)).total
  return sum / plays
}
