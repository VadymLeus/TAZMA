// tests/estimator.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FlowEstimator } from '../src/pipeline/estimator.ts'
import { throughputLimit } from '../src/pipeline/limit.ts'
import { drifting, needsDepth, simulate, unevenTimes } from './pipelineSim.ts'

const bottleneck = (stages: number[]) => 1000 / Math.max(...stages)
const fixed = (limit: number) => ({ limit, admitted() {}, completed() {} })
const latency = (stages: number[]) => stages.reduce((a, b) => a + b, 0) / 1000

describe('FlowEstimator on a simulated pipeline', () => {
  it('measures the latency of an empty pipeline and the rate of its slowest stage', () => {
    const stages = [10, 10, 10, 10, 10]
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    simulate(stages, 400, estimator)
    assert.ok(Math.abs((estimator.latency as number) - latency(stages)) < 0.002)
    assert.ok(Math.abs((estimator.rate as number) - bottleneck(stages)) < 3)
    assert.equal(estimator.phase, 'steady')
  })

  it('does not take the pace of frames that only fill the queues for the rate', () => {
    const stages = [5, 5, 40, 5, 5]
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    simulate(stages, 400, estimator)
    assert.ok(Math.abs((estimator.rate as number) - bottleneck(stages)) < 1)
  })

  it('arrives at N = ⌈λ·W0·(1+δ)⌉ and keeps the pipeline at full speed', () => {
    const stages = [10, 10, 10, 10, 10]
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    const result = simulate(stages, 600, estimator)
    // λ = 100/s, W0 = 50 ms, δ = 25 %: 100 · 0.05 · 1.25 = 6.25, so 7.
    assert.equal(estimator.settledLimit, 7)
    assert.ok(result.tailRate >= 0.97 * bottleneck(stages))
  })

  it('needs few frames when one slow stage sets the pace', () => {
    const stages = [5, 5, 40, 5, 5]
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    const result = simulate(stages, 400, estimator)
    assert.ok(estimator.settledLimit >= 2 && estimator.settledLimit <= 3)
    assert.ok(result.tailRate >= 0.97 * bottleneck(stages))
  })

  it('does not go over the memory limit, and loses speed by exactly that much', () => {
    const stages = [10, 10, 10, 10, 10]
    const estimator = new FlowEstimator({ memoryLimit: 3 })
    const result = simulate(stages, 600, estimator)
    assert.equal(estimator.limit, 3)
    assert.ok(result.peak <= 3)
    // Three frames in a line of 50 ms: 60 frames a second.
    assert.ok(Math.abs(result.tailRate - 60) < 2)
  })

  it('works with the frames in flight one at a time while it calibrates', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    const result = simulate([10, 10, 10], 12, estimator)
    assert.equal(result.peak, 1)
    assert.equal(estimator.phase, 'probe')
  })

  it('opens the queues once the latency is known', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    const result = simulate([10, 10, 10, 10, 10], 30, estimator)
    assert.equal(estimator.phase, 'probe')
    assert.equal(result.peak, 16)
  })

  it('does not count the first frames, which pay for starting the codecs', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    estimator.admitted(0)
    estimator.completed(0.5)
    estimator.admitted(0.5)
    estimator.completed(1)
    for (let i = 0; i < 10; i++) {
      const t = 1 + i * 0.03
      estimator.admitted(t)
      estimator.completed(t + 0.03)
    }
    assert.ok(Math.abs((estimator.latency as number) - 0.03) < 1e-9)
  })

  it('takes the middle value, so a single slow frame does not move the latency', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, warmup: 0, calibration: 5 })
    const times = [0.03, 0.03, 0.4, 0.03, 0.03]
    let t = 0
    for (const span of times) {
      estimator.admitted(t)
      t += span
      estimator.completed(t)
    }
    assert.ok(Math.abs((estimator.latency as number) - 0.03) < 1e-9)
  })

  it('measures the rate again from time to time, and may lower it then', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, reprobeEvery: 100, reprobeSeconds: 0, feedback: false })
    simulate([10, 10, 10, 10, 10], 200, estimator)
    const before = estimator.rate as number
    assert.ok(before > 90)
    // The next frames come out at half the rate.
    let t = 10
    for (let i = 0; i < 150; i++) {
      estimator.admitted(t)
      t += 0.02
      estimator.completed(t)
    }
    assert.ok((estimator.rate as number) < before * 0.7)
  })

  it('never lowers the rate between measurements', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, reprobeEvery: 100000 })
    simulate([10, 10, 10, 10, 10], 200, estimator)
    const rate = estimator.rate as number
    let t = 10
    for (let i = 0; i < 200; i++) {
      estimator.admitted(t)
      t += 0.05
      estimator.completed(t)
    }
    assert.equal(estimator.rate, rate)
  })

  it('does not take a burst of frames, such as the last ones out of a flushed encoder, for a pace', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, reprobeEvery: 100000 })
    simulate([10, 10, 10, 10, 10], 200, estimator)
    const rate = estimator.rate as number
    let t = 10
    for (let i = 0; i < 31; i++) {
      estimator.admitted(t)
      t += 0.0005
      estimator.completed(t)
    }
    assert.equal(estimator.rate, rate)
  })

  it('does follow a rate that stays higher for two windows, but by 1.5 times a window at most', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, reprobeEvery: 100000 })
    simulate([10, 10, 10, 10, 10], 200, estimator)
    const rate = estimator.rate as number
    let t = 10
    for (let i = 0; i < 130; i++) {
      estimator.admitted(t)
      t += 0.0005
      estimator.completed(t)
    }
    const after = estimator.rate as number
    // The first window holds the old pace, then 1.5 times at most for each one.
    assert.ok(after > rate)
    assert.ok(after <= rate * 1.5 ** 3 + 1e-9)
  })

  it('forgets the entries of frames that left without finishing', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, warmup: 0, calibration: 3 })
    estimator.admitted(0)
    estimator.admitted(0.1)
    estimator.dropped(1)
    estimator.completed(0.13)
    estimator.admitted(0.2)
    estimator.completed(0.23)
    estimator.admitted(0.3)
    estimator.completed(0.33)
    assert.ok(Math.abs((estimator.latency as number) - 0.03) < 1e-9)
  })
})

describe('FlowEstimator feedback on the limit', () => {
  const stages = [8, 6, 10, 6, 8]
  // The first stage is 1.7 times slower while fewer than 26 frames are inside:
  // the rate does not move with the limit until the limit is 26.
  const step = needsDepth(26, 1.7)

  it('finds the step the formula and small increases miss, and the smallest limit past it', () => {
    const estimator = new FlowEstimator({ memoryLimit: 194 })
    const result = simulate(stages, 6000, estimator, 1000, step)
    const plateau = simulate(stages, 6000, fixed(64), 1000, step)
    const byFormula = throughputLimit(estimator.rate as number, estimator.latency as number, 0.25)
    const formulaOnly = simulate(stages, 6000, fixed(byFormula), 1000, step)
    assert.ok(formulaOnly.tailRate < 0.8 * plateau.tailRate)
    assert.ok(result.tailRate >= 0.97 * plateau.tailRate, `${result.tailRate} against ${plateau.tailRate}`)
    const level = estimator.feedback.level as number
    assert.ok(level >= 26 && level <= 32, `level ${level}`)
    assert.equal(estimator.settledLimit, level)
    assert.equal(estimator.feedback.kept, 1)
  })

  it('records the rate at every limit it tried', () => {
    const estimator = new FlowEstimator({ memoryLimit: 194 })
    simulate(stages, 6000, estimator, 1000, step)
    const trials = estimator.feedback.trials
    const at = (limit: number) => trials.find((item) => item.limit === limit)?.rate as number
    assert.ok(trials.length >= 4)
    // The first limit tried is high, and it gives the rate of the plateau.
    assert.equal(at(48) > 1.3 * trials[0]!.rate, true)
    // A limit under the step gives the low rate, one past it the high rate.
    assert.ok(trials.some((item) => item.limit < 26 && item.rate < 0.8 * at(48)))
    assert.ok(trials.some((item) => item.limit >= 26 && item.rate > 0.97 * at(48)))
  })

  it('reaches the rate a roomy limit gives when frame times are uneven, which the formula alone does not', () => {
    for (const [low, high] of [[0.2, 1.8], [0.3, 2.4]] as const) {
      const estimator = new FlowEstimator({ memoryLimit: 64 })
      const result = simulate(stages, 6000, estimator, 1000, unevenTimes(low, high, 7))
      const plateau = simulate(stages, 6000, fixed(64), 1000, unevenTimes(low, high, 7))
      const byFormula = throughputLimit(estimator.rate as number, estimator.latency as number, 0.25)
      const formulaOnly = simulate(stages, 6000, fixed(byFormula), 1000, unevenTimes(low, high, 7))
      assert.ok(result.tailRate >= 0.97 * plateau.tailRate, `${result.tailRate} against ${plateau.tailRate}`)
      assert.ok(formulaOnly.tailRate < 0.95 * plateau.tailRate, `${formulaOnly.tailRate} against ${plateau.tailRate}`)
      assert.ok(estimator.feedback.kept >= 1)
      assert.ok((estimator.feedback.level as number) > byFormula)
    }
  })

  it('does not go over the memory limit while looking for a higher one', () => {
    for (const memory of [5, 20]) {
      const estimator = new FlowEstimator({ memoryLimit: memory })
      const result = simulate(stages, 6000, estimator, 1000, step)
      assert.ok(result.peak <= memory)
      assert.ok(Math.max(...result.limits) <= memory)
      assert.ok((estimator.feedback.level ?? 0) <= memory)
      assert.ok(estimator.feedback.trials.every((item) => item.limit <= memory))
    }
  })

  it('does not take the machine speeding up and slowing down for a gain from a higher limit', () => {
    for (const [amount, period, phase] of [[0.12, 2500, 0], [0.12, 2500, 900], [0.15, 4000, 1700], [0.1, 1500, 300]]) {
      const estimator = new FlowEstimator({ memoryLimit: 194 })
      simulate([10, 10, 10, 10, 10], 20000, estimator, 1000, drifting(amount as number, period as number, phase as number))
      assert.equal(estimator.feedback.kept, 0, `drift ${amount} over ${period} from ${phase}`)
      assert.equal(estimator.feedback.level, null)
    }
  })

  it('still finds a step when the machine is speeding up and slowing down', () => {
    const both = (a: typeof step, b: typeof step) => (stage: number, frame: number, inside: number) =>
      a(stage, frame, inside) * b(stage, frame, inside)
    const jitter = both(step, drifting(0.1, 3000))
    const estimator = new FlowEstimator({ memoryLimit: 194 })
    const result = simulate(stages, 20000, estimator, 2000, jitter)
    const plateau = simulate(stages, 20000, fixed(64), 2000, jitter)
    assert.ok(result.tailRate >= 0.93 * plateau.tailRate, `${result.tailRate} against ${plateau.tailRate}`)
    assert.ok((estimator.feedback.level ?? 0) >= 26)
  })

  it('keeps nothing when a higher limit gives no more frames, and tries less and less often', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    const result = simulate([10, 10, 10, 10, 10], 20000, estimator)
    assert.equal(estimator.feedback.kept, 0)
    assert.equal(estimator.feedback.level, null)
    assert.ok(estimator.feedback.tried >= 1 && estimator.feedback.tried <= 8, `${estimator.feedback.tried} tries`)
    assert.equal(estimator.settledLimit, 7)
    assert.ok(result.tailRate >= 0.97 * bottleneck([10, 10, 10, 10, 10]))
  })

  it('does not try at all while the frames in flight stay under the limit', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000 })
    simulate([10, 10, 10, 10, 10], 200, estimator)
    assert.equal(estimator.phase, 'steady')
    // From here frames come one at a time, as if the input could not keep up.
    let t = 10
    const feed = (count: number) => {
      for (let i = 0; i < count; i++) {
        estimator.admitted(t)
        t += 0.01
        estimator.completed(t)
      }
    }
    // A try that was already under way when the input slowed is let finish.
    feed(1500)
    const tried = estimator.feedback.tried
    feed(4000)
    assert.equal(estimator.feedback.tried, tried)
  })

  it('leaves the limit to the formula when told to', () => {
    const estimator = new FlowEstimator({ memoryLimit: 194, feedback: false })
    const result = simulate(stages, 6000, estimator, 1000, step)
    assert.equal(estimator.feedback.tried, 0)
    assert.equal(estimator.settledLimit, estimator.performanceLimit)
    assert.ok(result.tailRate < 80)
  })

  it('goes on trying, ever more rarely, through the measurements of the rate', () => {
    const tries = (frames: number) => {
      const estimator = new FlowEstimator({ memoryLimit: 194, reprobeEvery: 900, reprobeSeconds: 0 })
      simulate(stages, frames, estimator, 1000, step)
      return estimator.feedback.tried
    }
    const early = tries(6000)
    const late = tries(40000)
    assert.ok(late > early, `${late} tries against ${early}`)
    assert.ok(late - early <= 6, `${late - early} tries in 34000 frames`)
  })

  it('does not measure the rate again in the middle of a try', () => {
    // A measurement every 100 frames would cut every try short if it could.
    const estimator = new FlowEstimator({ memoryLimit: 194, reprobeEvery: 100, reprobeSeconds: 0 })
    simulate(stages, 12000, estimator, 1000, step)
    const level = estimator.feedback.level as number
    assert.ok(level >= 26 && level <= 32, `level ${level}`)
  })

  it('does not measure the rate again before the time is up, however many frames came', () => {
    const estimator = new FlowEstimator({ memoryLimit: 1000, reprobeEvery: 100, reprobeSeconds: 1000 })
    simulate([10, 10, 10, 10, 10], 1000, estimator)
    assert.equal(estimator.phase, 'steady')
  })
})
