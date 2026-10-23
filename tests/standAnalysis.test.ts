// tests/standAnalysis.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { analyzeInterval, fitCheckpoint } from '../src/stand/analysis.ts'
import type { RunRecord } from '../src/stand/record.ts'
import { intervalSeries, parseIntervals, ignoredIntervals } from '../src/stand/series.ts'

const options = { seconds: 60, limits: [], segmentSeconds: 10, intervals: [8, 2], mtbfSeconds: 10, shares: [0, 0.5], cutCounts: [0, 2], cuts: 0, share: 0.25, kind: 'text' as const }
const series = intervalSeries(options)

let index = 0
function rec(condition: string, round: number, over: Partial<RunRecord> = {}): RunRecord {
  return {
    series: 'interval',
    condition,
    label: condition,
    index: index++,
    round,
    warmup: false,
    ok: true,
    error: '',
    wallMs: 10000,
    duration: 60,
    checkpointMs: null,
    restartMs: null,
    crashes: null,
    ...over,
  } as RunRecord
}

const crashed = (condition: string, round: number, wallMs: number, over: Partial<RunRecord> = {}) =>
  rec(condition, round, { wallMs, checkpointMs: 50, restartMs: 400, crashes: 3, ...over })

describe('intervalSeries', () => {
  it('has the plain export, then a journal without cuts and one with cuts for every length, rising', () => {
    assert.deepEqual(series.conditions.map((c) => c.id), ['ref', 'nc-2', 'nc-8', 'tau-2', 'tau-8'])
    assert.equal(series.conditions[0].crashMeanMs, undefined)
    assert.equal(series.conditions[1].crashMeanMs, undefined)
    assert.equal(series.conditions[3].crashMeanMs, 10000)
    assert.equal(series.conditions[3].settings.segmentSeconds, 2)
    assert.equal(series.conditions[1].settings.resumable, true)
    assert.equal(series.conditions[0].settings.resumable, false)
    assert.equal(series.conditions[3].interval, 2)
  })
})

describe('parseIntervals', () => {
  it('reads spaces, semicolons, commas before spaces and decimal commas', () => {
    assert.deepEqual(parseIntervals('0.5, 1; 2 4,5 8'), [0.5, 1, 2, 4.5, 8])
  })

  it('keeps those within the limits, once each, rising', () => {
    assert.deepEqual(parseIntervals('8 2 2 0 -1 1000 abc 0.25'), [0.25, 2, 8])
    assert.deepEqual(ignoredIntervals('8 2 2 0 -1 1000 abc 0.25'), ['0', '-1', '1000', 'abc'])
  })
})

describe('fitCheckpoint', () => {
  it('finds the cost of a checkpoint and what the journal costs once', () => {
    const points = [4, 8, 16, 32].map((commits) => ({ commits, extra: 0.3 + 0.1 * commits }))
    const fit = fitCheckpoint(points)
    assert.ok(fit)
    assert.ok(Math.abs(fit.perCommit - 0.1) < 1e-9)
    assert.ok(Math.abs(fit.fixed - 0.3) < 1e-9)
  })

  it('shares the extra time over the checkpoints when only one count was run', () => {
    const fit = fitCheckpoint([{ commits: 10, extra: 1 }, { commits: 10, extra: 1.4 }])
    assert.ok(fit)
    assert.ok(Math.abs(fit.perCommit - 0.12) < 1e-9)
    assert.equal(fit.fixed, 0)
  })

  it('does not let a falling line give a negative cost', () => {
    const fit = fitCheckpoint([{ commits: 2, extra: 0.5 }, { commits: 10, extra: 0.1 }])
    assert.ok(fit)
    assert.equal(fit.perCommit, 0)
    assert.ok(fit.fixed > 0)
  })

  it('has nothing to fit without runs', () => {
    assert.equal(fitCheckpoint([]), null)
    assert.equal(fitCheckpoint([{ commits: 0, extra: 1 }]), null)
  })
})

describe('analyzeInterval', () => {
  const rounds = [0, 1, 2]
  const records = [
    ...rounds.map((round) => rec('ref', round)),
    ...rounds.map((round) => crashed('tau-2', round, 12000 + round * 100)),
    ...rounds.map((round) => crashed('tau-8', round, 11000 + round * 100)),
    rec('ref', -1, { warmup: true, wallMs: 99999 }),
  ]

  it('needs a plain run to measure against', () => {
    assert.equal(analyzeInterval(records.filter((r) => r.condition !== 'ref'), series.conditions, 10000), null)
  })

  it('takes the plain time and the speed from the plain runs, leaving warm-ups out', () => {
    const found = analyzeInterval(records, series.conditions, 10000)
    assert.ok(found)
    assert.equal(found.plain, 10)
    assert.equal(found.speed, 6)
    assert.equal(found.mtbf, 10)
  })

  it('gives the mean waste with its standard error and compares the row nearest to the formula with the best', () => {
    const found = analyzeInterval(records, series.conditions, 10000)
    assert.ok(found)
    const [short, long] = found.rows
    assert.ok(Math.abs((short.wasteMean ?? 0) - 0.21) < 1e-9)
    assert.ok((short.wasteSe ?? -1) > 0)
    assert.ok(Math.abs((long.wasteMean ?? 0) - 0.11) < 1e-9)
    assert.ok(found.verdict)
    assert.equal(found.verdict.best, 'tau-8')
    // Young's interval for 50 ms and 10 s is 1 s of work, 6 s of timeline.
    assert.equal(found.verdict.formula, 'tau-8')
    assert.equal(found.verdict.difference, 0)
  })

  it('measures the waste as the paired ratio minus one and names the best', () => {
    const found = analyzeInterval(records, series.conditions, 10000)
    assert.ok(found)
    assert.deepEqual(found.rows.map((row) => row.condition), ['tau-2', 'tau-8'])
    assert.deepEqual(found.rows.map((row) => row.quiet), ['nc-2', 'nc-8'])
    const [short, long] = found.rows
    assert.ok(Math.abs((short.waste?.median ?? 0) - 0.21) < 1e-9)
    assert.ok(Math.abs((long.waste?.median ?? 0) - 0.11) < 1e-9)
    assert.equal(found.best, 'tau-8')
    assert.equal(short.wall?.median, 12.1)
    assert.equal(short.n, 3)
  })

  it('works out Young’s interval from the measured cost, and its place on the timeline', () => {
    const found = analyzeInterval(records, series.conditions, 10000)
    assert.ok(found)
    assert.equal(found.cost, 0.05)
    assert.equal(found.restart, 0.4)
    assert.ok(found.young)
    assert.ok(Math.abs(found.young.work - Math.sqrt(2 * 0.05 * 10)) < 1e-9)
    assert.ok(Math.abs(found.young.timeline - found.young.work * 6) < 1e-9)
    assert.ok(found.exact && found.exact.work > 0)
  })

  it('gives the formula’s waste for each row in seconds of work', () => {
    const found = analyzeInterval(records, series.conditions, 10000)
    assert.ok(found)
    const row = found.rows[0]
    assert.ok(Math.abs(row.work - 2 / 6) < 1e-9)
    assert.ok(Math.abs((row.young ?? 0) - (0.05 / (2 / 6) + 2 / 6 / 20)) < 1e-9)
    assert.ok((row.exact ?? 0) > (row.young ?? 0) - 0.5)
  })

  it('reads the cost of a checkpoint from the extra time of the runs without cuts', () => {
    const quiet = (condition: string, round: number, wallMs: number, commits: number) =>
      rec(condition, round, { wallMs, commits, checkpointMs: 40 })
    const withQuiet = [
      ...records,
      ...rounds.map((round) => quiet('nc-2', round, 10000 + 100 + 30 * 100, 30)),
      ...rounds.map((round) => quiet('nc-8', round, 10000 + 100 + 8 * 100, 8)),
    ]
    const found = analyzeInterval(withQuiet, series.conditions, 10000)
    assert.ok(found)
    assert.ok(found.effective)
    assert.ok(Math.abs(found.effective.perCommit - 0.1) < 1e-9)
    assert.ok(Math.abs(found.effective.fixed - 0.1) < 1e-9)
    assert.equal(found.cost, 0.04)
    const [short, long] = found.rows
    assert.equal(short.commits, 30)
    assert.ok(Math.abs((short.overhead?.median ?? 0) - 0.31) < 1e-9)
    assert.ok(Math.abs((long.overhead?.median ?? 0) - 0.09) < 1e-9)
    assert.ok(found.youngEffective && found.young)
    assert.ok(found.youngEffective.work > found.young.work)
  })

  it('leaves the cost and the formula empty when no run measured a checkpoint', () => {
    const bare = [...rounds.map((round) => rec('ref', round)), ...rounds.map((round) => rec('tau-2', round, { wallMs: 11000 }))]
    const found = analyzeInterval(bare, series.conditions, 10000)
    assert.ok(found)
    assert.equal(found.cost, null)
    assert.equal(found.young, null)
    assert.equal(found.rows[0].young, null)
    assert.ok(found.rows[0].waste)
  })

  it('puts a number on how much worse the formula’s row is than the best', () => {
    const two = [0, 1, 2, 3].flatMap((round) => [
      rec('ref', round),
      crashed('tau-2', round, 12000 + round * 200),
      crashed('tau-8', round, 15000 + round * 500),
    ])
    const found = analyzeInterval(two, series.conditions, 10000)
    assert.ok(found?.verdict)
    // the formula's row (6 s of timeline) is tau-8; the best is tau-2
    assert.equal(found.verdict.best, 'tau-2')
    assert.equal(found.verdict.formula, 'tau-8')
    assert.ok(found.verdict.difference > 0.25 && found.verdict.difference < 0.45)
    assert.equal(found.verdict.n, 4)
    assert.ok(found.verdict.se > 0)
  })

  it('does not count failed runs', () => {
    const withFailure = [...records, crashed('tau-8', 3, 99999, { ok: false })]
    const found = analyzeInterval(withFailure, series.conditions, 10000)
    assert.ok(found)
    assert.equal(found.rows[1].n, 3)
  })
})
