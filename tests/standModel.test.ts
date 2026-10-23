// tests/standModel.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { optimalInterval } from '../src/resume/interval.ts'
import { exponentialGaps } from '../src/stand/gaps.ts'
import { exactOptimum, expectedTime, expectedWaste, simulateRun, simulatedMean } from '../src/stand/model.ts'
import type { ModelInput } from '../src/stand/model.ts'

const base: ModelInput = { work: 600, cost: 0.5, interval: 20, mtbf: 100, restart: 3 }

describe('expectedTime', () => {
  it('equals the work when cuts never happen and checkpoints are free', () => {
    const time = expectedTime({ ...base, cost: 0, restart: 0, mtbf: 1e12 })
    assert.ok(Math.abs(time - base.work) < 1e-3)
  })

  it('adds the checkpoints when cuts are rare', () => {
    const time = expectedTime({ ...base, mtbf: 1e12, restart: 0 })
    assert.ok(Math.abs(time - (base.work + (base.work / base.interval) * base.cost)) < 1e-2)
  })

  it('grows with the cost of a restart', () => {
    assert.ok(expectedTime({ ...base, restart: 10 }) > expectedTime({ ...base, restart: 1 }))
  })

  it('rejects numbers that cannot be times', () => {
    assert.throws(() => expectedTime({ ...base, interval: 0 }), RangeError)
    assert.throws(() => expectedTime({ ...base, mtbf: -1 }), RangeError)
    assert.throws(() => expectedTime({ ...base, cost: Number.NaN }), RangeError)
  })
})

describe('simulateRun', () => {
  it('finishes in one attempt when the first gap is long', () => {
    const run = simulateRun({ ...base, work: 10, interval: 5, cost: 1, restart: 2 }, () => 1000)
    assert.deepEqual(run, { total: 12, crashes: 0 })
  })

  it('loses the work since the last checkpoint at a cut and pays the restart', () => {
    // parts of 5 s + 1 s checkpoint: the first gap of 8 s keeps one part (6 s)
    // and loses 2 s; the second attempt needs 2 s restart, then the last part.
    const gaps = [8, 1000]
    const run = simulateRun({ ...base, work: 10, interval: 5, cost: 1, restart: 2 }, () => gaps.shift() as number)
    assert.deepEqual(run, { total: 8 + 2 + 6, crashes: 1 })
  })

  it('lets a cut fall inside the restart', () => {
    const gaps = [8, 1, 1000]
    const run = simulateRun({ ...base, work: 10, interval: 5, cost: 1, restart: 2 }, () => gaps.shift() as number)
    assert.deepEqual(run, { total: 8 + 1 + 2 + 6, crashes: 2 })
  })

  it('gives up when no attempt can ever finish', () => {
    assert.throws(() => simulateRun({ ...base, work: 10, interval: 5, cost: 1, restart: 0 }, () => 0.5, 50), /спроб/)
  })

  it('agrees with the expected time on average', () => {
    const input = { ...base, work: 400, interval: 20, mtbf: 80, restart: 4 }
    const mean = simulatedMean(input, (play) => exponentialGaps(7, play, input.mtbf), 20000)
    const expected = expectedTime(input)
    assert.ok(Math.abs(mean / expected - 1) < 0.015, `${mean} against ${expected}`)
  })
})

describe('the optimum', () => {
  it('is close to Young’s τ when the cost is small against the time between cuts', () => {
    const input = { work: 3600, cost: 0.05, mtbf: 600, restart: 2 }
    const exact = exactOptimum(input)
    const young = optimalInterval(input.cost, input.mtbf)
    assert.ok(Math.abs(exact / young - 1) < 0.1, `${exact} against ${young}`)
  })

  it('does not move with the restart cost in Young’s formula and moves little in the exact one', () => {
    const near = exactOptimum({ work: 3600, cost: 0.05, mtbf: 600, restart: 0 })
    const far = exactOptimum({ work: 3600, cost: 0.05, mtbf: 600, restart: 30 })
    assert.ok(Math.abs(far / near - 1) < 0.05)
  })

  it('is where the simulated mean is least over a grid', () => {
    const input = { work: 300, cost: 0.4, mtbf: 40, restart: 1.5 }
    const grid = [0.5, 1, 2, 4, 8, 16, 32, 64]
    const means = grid.map((interval) =>
      simulatedMean({ ...input, interval }, (play) => exponentialGaps(3, play, input.mtbf), 3000),
    )
    const best = grid[means.indexOf(Math.min(...means))]
    const young = optimalInterval(input.cost, input.mtbf)
    assert.ok(best / young < 2 && young / best < 2, `best ${best}, formula ${young}`)
  })

  it('wastes about √(2·t_c/M) at the optimum', () => {
    const input = { work: 3600, cost: 0.05, mtbf: 600, restart: 0 }
    const waste = expectedWaste({ ...input, interval: optimalInterval(input.cost, input.mtbf) })
    assert.ok(Math.abs(waste / Math.sqrt((2 * input.cost) / input.mtbf) - 1) < 0.1)
  })
})

describe('exponentialGaps', () => {
  it('repeats for the same seed and stream', () => {
    const a = exponentialGaps(1, 2, 1000)
    const b = exponentialGaps(1, 2, 1000)
    for (let i = 0; i < 10; i++) assert.equal(a(), b())
  })

  it('differs between streams and seeds', () => {
    assert.notEqual(exponentialGaps(1, 2, 1000)(), exponentialGaps(1, 3, 1000)())
    assert.notEqual(exponentialGaps(1, 2, 1000)(), exponentialGaps(2, 2, 1000)())
  })

  it('has the mean asked for and positive gaps', () => {
    const next = exponentialGaps(5, 0, 2500)
    let sum = 0
    const n = 50000
    for (let i = 0; i < n; i++) {
      const gap = next()
      assert.ok(gap > 0)
      sum += gap
    }
    assert.ok(Math.abs(sum / n / 2500 - 1) < 0.02)
  })

  it('refuses a mean that is not positive', () => {
    assert.throws(() => exponentialGaps(1, 0, 0), RangeError)
  })
})
