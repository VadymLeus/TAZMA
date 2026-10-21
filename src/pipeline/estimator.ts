// src/pipeline/estimator.ts
import { combineLimits, MAX_LIMIT, throughputLimit } from './limit.ts'

export type FlowPhase = 'calibrate' | 'probe' | 'steady'

export interface EstimatorOptions {
  // N_mem, from the memory budget.
  memoryLimit: number
  // Reserve for uneven frame times (δ).
  margin?: number
  // Frames ignored at the start: the first ones pay for starting the codecs.
  warmup?: number
  // Frames, one at a time, that give the latency of an empty pipeline.
  calibration?: number
  // Frames, with room to queue, that give the throughput of the slowest stage.
  probe?: number
  probeLimit?: number
  // Throughput is measured again after this many frames, and not before this
  // many seconds have passed.
  reprobeEvery?: number
  reprobeSeconds?: number
  minLimit?: number
  // Whether the limit is tried higher from time to time (see CLIMB_* below);
  // off, the limit is the formula's alone.
  feedback?: boolean
}

const DEFAULTS = {
  margin: 0.25,
  warmup: 2,
  calibration: 10,
  probe: 30,
  probeLimit: 16,
  reprobeEvery: 900,
  reprobeSeconds: 30,
  minLimit: 2,
  feedback: true,
}
// Frames dropped from the start of a probe on top of the queue depth: until
// the queues are full, frames come out at the pace they went in.
const PROBE_EXTRA = 4
// The rate rises only when two windows in a row are above it, and by this
// factor at most: decoders and encoders give out frames in bursts (when
// flushed, or when a new one starts), and a burst is not a pace.
const GROWTH = 1.5
const WINDOW = 30

// Feedback on the limit. The formula takes the time of a frame in an empty
// pipeline as the time in a busy one, and assumes the stages take the same time
// for every frame; real ones do neither (hardware decoders work best with a
// deep queue, encoders give frames out in bursts), so the rate does not rise
// smoothly with the limit and a limit that is just enough for the formula
// leaves the slowest stage short of work. So the limit is tried far higher
// from time to time. If the rate really is higher there, the smallest limit
// that keeps nearly all of it is found by halving the gap. Each measurement
// covers at least this many frames and seconds.
const CLIMB_WINDOW = 200
const CLIMB_SPAN = 2
// The limit is tried at twice the one in force, and at this at least.
const CLIMB_CEIL = 48
// The rate at the high limit must be this share above the rate at the old
// limit, measured before and again after it (the speed of the machine drifts
// by about as much from one window to the next), for the search to go on.
const CLIMB_GAIN = 0.06
// A limit is as good as the highest one if it gives this share of its rate.
const CLIMB_KEEP = 0.97
// Frames after a change of the limit that are left out of the measurement.
const CLIMB_SETTLE = 10
// Frames to wait before the first try and after a try that did not pay off;
// the wait doubles up to the largest value.
const CLIMB_REST = 100
const CLIMB_REST_MAX = 6400
// How many measurements the report keeps.
const CLIMB_LOG = 24

type ClimbStage = 'rest' | 'baseline' | 'settle' | 'measure'

// The rate measured with the limit at `limit`.
export interface ClimbTrial {
  limit: number
  rate: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

// Works out the limit N from what the running pipeline shows. Frames are
// measured one at a time first, which gives the time W0 a frame needs when
// nothing waits; then the queues are opened for a while and the rate λ of the
// slowest stage is read from how fast frames come out. N_perf = ⌈λ·W0·(1+δ)⌉
// and N = min(N_mem, N_perf). Time is given by the caller, in seconds.
export class FlowEstimator {
  private readonly o: Required<EstimatorOptions>
  private stage: FlowPhase = 'calibrate'
  private entered: number[] = []
  private done = 0
  private samples: number[] = []
  private stamps: number[] = []
  private windowStart: number | null = null
  private windowCount = 0
  private lastWindow = 0
  private sinceProbe = 0
  private w0: number | null = null
  private lambda: number | null = null
  private skip: number
  private probedAt = 0
  private climb: ClimbStage = 'rest'
  private rest = CLIMB_REST
  private restNext = CLIMB_REST
  private winStart = 0
  private winCount = 0
  private winPeak = 0
  private baseRate = 0
  private baseLimit = 0
  private settleLeft = 0
  private trialLimit: number | null = null
  // While the gap between a limit that is too low and one that is enough is
  // being halved: the two, and the rate at the higher one.
  private gap: { low: number; high: number; rate: number } | null = null
  // Between a high limit that looks better and the old limit measured again.
  private confirm: { depth: number; rate: number } | null = null
  private climbedTo: number | null = null
  private tried = 0
  private kept = 0
  private trials: ClimbTrial[] = []

  constructor(options: EstimatorOptions) {
    this.o = { ...DEFAULTS, ...options }
    this.skip = Math.max(1, Math.min(this.o.memoryLimit, this.o.probeLimit)) + PROBE_EXTRA
  }

  get phase(): FlowPhase {
    return this.stage
  }

  // W0 in seconds, once measured.
  get latency(): number | null {
    return this.w0
  }

  // λ in frames per second, once measured.
  get rate(): number | null {
    return this.lambda
  }

  // N_perf by the formula, once both W0 and λ are known.
  private get formulaLimit(): number | null {
    if (this.w0 === null || this.lambda === null) return null
    return throughputLimit(this.lambda, this.w0, this.o.margin)
  }

  // N_perf: the formula, or higher if the rate of frames showed that the
  // formula's limit was too low.
  get performanceLimit(): number | null {
    const formula = this.formulaLimit
    if (formula === null) return null
    return Math.max(formula, this.climbedTo ?? 0)
  }

  // What the feedback did: tries made, searches that found a higher limit, the
  // limit it reached, and the rate measured at each limit tried.
  get feedback(): { tried: number; kept: number; level: number | null; trials: ClimbTrial[] } {
    return { tried: this.tried, kept: this.kept, level: this.climbedTo, trials: [...this.trials] }
  }

  // The limit in force, a try included.
  get limit(): number {
    return this.limitWith(this.trialLimit)
  }

  // The limit the pipeline has settled on, leaving a try out.
  get settledLimit(): number {
    return this.limitWith(null)
  }

  private limitWith(trial: number | null): number {
    if (this.stage === 'calibrate') return 1
    if (this.stage === 'probe') return Math.max(1, Math.min(this.o.memoryLimit, this.o.probeLimit))
    const byThroughput = trial ?? this.performanceLimit ?? this.o.probeLimit
    return Math.max(this.o.minLimit, combineLimits(this.o.memoryLimit, byThroughput))
  }

  admitted(now: number): void {
    this.entered.push(now)
    if (this.entered.length > this.winPeak) this.winPeak = this.entered.length
  }

  // Frames that left without finishing: their entry times are forgotten.
  dropped(count: number): void {
    this.entered.splice(0, count)
  }

  completed(now: number): void {
    const since = this.entered.shift()
    this.done++
    if (this.stage === 'calibrate') {
      if (since === undefined || this.done <= this.o.warmup) return
      this.samples.push(now - since)
      if (this.samples.length >= this.o.calibration) {
        this.w0 = Math.max(1e-6, median(this.samples))
        this.startProbe()
      }
    } else if (this.stage === 'probe') {
      this.stamps.push(now)
      if (this.stamps.length >= this.skip + this.o.probe) this.finishProbe()
    } else {
      this.sinceProbe++
      this.watchRate(now)
      this.stepClimb(now)
      // Not in the middle of a try, which a measurement would cut short; the
      // wait before the next one goes on through measurements.
      if (this.climb === 'rest' && this.sinceProbe >= this.o.reprobeEvery && now - this.probedAt >= this.o.reprobeSeconds) {
        this.startProbe()
      }
    }
  }

  private startProbe(): void {
    this.stage = 'probe'
    this.stamps = []
    this.windowStart = null
  }

  private finishProbe(): void {
    const first = this.stamps[this.skip] as number
    const last = this.stamps[this.stamps.length - 1] as number
    const frames = this.stamps.length - 1 - this.skip
    if (last > first && frames > 0) this.lambda = frames / (last - first)
    this.stamps = []
    this.sinceProbe = 0
    this.probedAt = last
    this.windowStart = null
    this.windowCount = 0
    this.lastWindow = 0
    this.stage = 'steady'
    this.lambda ??= 1 / (this.w0 ?? 1)
  }

  private beginWindow(now: number, stage: ClimbStage): void {
    this.climb = stage
    this.winStart = now
    this.winCount = 0
    this.winPeak = this.entered.length
  }

  // A window is done when it holds enough frames and enough time.
  private windowRate(now: number): number | null {
    this.winCount++
    const span = now - this.winStart
    if (this.winCount < CLIMB_WINDOW || span < CLIMB_SPAN) return null
    return this.winCount / span
  }

  private stepClimb(now: number): void {
    if (!this.o.feedback) return
    if (this.climb === 'rest') {
      if (--this.rest <= 0) this.beginWindow(now, 'baseline')
    } else if (this.climb === 'baseline') {
      const rate = this.windowRate(now)
      if (rate === null) return
      this.baseRate = rate
      this.baseLimit = this.settledLimit
      this.note(this.baseLimit, rate)
      this.tryHigher()
    } else if (this.climb === 'settle') {
      if (--this.settleLeft <= 0) this.beginWindow(now, 'measure')
    } else {
      const rate = this.windowRate(now)
      if (rate === null) return
      this.endTrial(rate)
    }
  }

  private note(limit: number, rate: number): void {
    this.trials.push({ limit, rate })
    if (this.trials.length > CLIMB_LOG) this.trials.shift()
  }

  private trial(limit: number): void {
    this.tried++
    this.trialLimit = limit
    this.climb = 'settle'
    this.settleLeft = limit + CLIMB_SETTLE
  }

  // Tries a much higher limit, if the limit was in the way: if the frames in
  // flight never came up to it, a higher one changes nothing.
  private tryHigher(): void {
    const cap = Math.min(this.o.memoryLimit, MAX_LIMIT)
    const target = Math.min(cap, Math.max(this.baseLimit * 2, CLIMB_CEIL))
    if (this.winPeak < this.baseLimit || target <= this.baseLimit) {
      this.wait(false)
      return
    }
    this.trial(target)
  }

  private endTrial(rate: number): void {
    if (this.confirm !== null) {
      this.endConfirm(rate)
      return
    }
    const tried = this.trialLimit as number
    this.trialLimit = null
    this.note(tried, rate)
    if (this.gap === null) {
      // The frames in flight may not have come up to the limit; then the rate
      // belongs to the depth they did reach.
      const depth = Math.min(tried, this.winPeak)
      if (depth <= this.baseLimit || rate < this.baseRate * (1 + CLIMB_GAIN)) {
        this.wait(true)
        return
      }
      // Looks better. Measure the old limit again before believing it.
      this.confirm = { depth, rate }
      this.climb = 'settle'
      this.settleLeft = this.baseLimit + CLIMB_SETTLE
      return
    }
    if (rate >= this.gap.rate * CLIMB_KEEP) {
      this.gap.high = tried
    } else {
      this.gap.low = tried
    }
    this.halve()
  }

  private endConfirm(rate: number): void {
    const { depth, rate: high } = this.confirm as { depth: number; rate: number }
    this.confirm = null
    this.note(this.baseLimit, rate)
    if (high < Math.max(this.baseRate, rate) * (1 + CLIMB_GAIN)) {
      this.wait(true)
      return
    }
    this.gap = { low: this.baseLimit, high: depth, rate: high }
    this.halve()
  }

  // Tries the limit in the middle of the gap, until the gap is narrow.
  private halve(): void {
    const gap = this.gap as { low: number; high: number; rate: number }
    if (gap.high - gap.low > Math.max(1, Math.floor(gap.high / 8))) {
      this.trial(gap.low + Math.ceil((gap.high - gap.low) / 2))
      return
    }
    this.kept++
    this.climbedTo = gap.high
    this.baseRate = gap.rate
    this.gap = null
    this.wait(false)
  }

  private wait(longer: boolean): void {
    this.climb = 'rest'
    this.rest = this.restNext
    if (longer) this.restNext = Math.min(this.restNext * 2, CLIMB_REST_MAX)
  }

  // The rate only goes up between probes, slowly and on two windows at once: with N too
  // small the observed rate is the limiter's own, and believing it would shrink
  // N further, while a burst of frames would raise it far too much.
  private watchRate(now: number): void {
    if (this.windowStart === null) {
      this.windowStart = now
      this.windowCount = 0
      return
    }
    this.windowCount++
    if (this.windowCount < WINDOW) return
    const span = now - this.windowStart
    if (span > 0 && this.lambda !== null) {
      const observed = this.windowCount / span
      this.lambda = Math.max(this.lambda, Math.min(observed, this.lastWindow, this.lambda * GROWTH))
      this.lastWindow = observed
    }
    this.windowStart = now
    this.windowCount = 0
  }
}
