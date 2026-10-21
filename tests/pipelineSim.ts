// tests/pipelineSim.ts

export interface Controller {
  limit: number
  admitted(seconds: number): void
  completed(seconds: number): void
}

export interface SimResult {
  // Seconds the whole run took.
  total: number
  // Frames a second over the last `tail` frames.
  tailRate: number
  // Highest number of frames in flight.
  peak: number
  limits: number[]
}

// A line of single-server stages that each take stage[i] milliseconds a frame,
// first come first served. Frames are let in whenever fewer than the
// controller's limit are inside; the controller hears of every entry and exit.
// `jitter(stage, frame)` scales the time one frame takes at one stage; with
// none, the times are exactly as given.
// `inside` is the number of frames in the pipeline when this one enters, so a
// stage can be slower while the pipeline is shallow (as hardware decoders are).
export type Jitter = (stage: number, frame: number, inside: number) => number

// A repeatable source of uneven frame times: each stage takes between `low` and
// `high` times its usual time, by a fixed seed.
export function unevenTimes(low: number, high: number, seed = 1): Jitter {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return () => low + (high - low) * next()
}

export function simulate(
  stages: number[],
  frames: number,
  controller: Controller,
  tail = 200,
  jitter?: Jitter,
): SimResult {
  const free = stages.map(() => 0)
  const pending: number[] = []
  let time = 0
  let inside = 0
  let entered = 0
  let finished = 0
  let peak = 0
  let tailStart = 0
  const limits: number[] = []
  while (finished < frames) {
    if (entered < frames && inside < controller.limit) {
      let t = time
      for (let i = 0; i < stages.length; i++) {
        const scale = jitter ? jitter(i, entered, inside) : 1
        t = Math.max(t, free[i] as number) + ((stages[i] as number) * scale) / 1000
        free[i] = t
      }
      pending.push(t)
      inside++
      entered++
      peak = Math.max(peak, inside)
      controller.admitted(time)
    } else {
      time = Math.max(time, pending.shift() as number)
      inside--
      finished++
      controller.completed(time)
      limits.push(controller.limit)
      if (finished === frames - tail) tailStart = time
    }
  }
  return { total: time, tailRate: tail / (time - tailStart), peak, limits }
}

// A first stage that needs `depth` frames in the pipeline to work at its best
// and is `slow` times slower while fewer are inside: a response to the limit
// that is flat up to `depth` and steps up there.
export function needsDepth(depth: number, slow: number): Jitter {
  return (stage, _frame, inside) => (stage === 0 && inside < depth ? slow : 1)
}

// The whole machine getting slower and faster by `amount` (0.1 is 10 %) over
// `period` frames, as it does with other work going on beside the export.
export function drifting(amount: number, period: number, phase = 0): Jitter {
  return (_stage, frame) => 1 + amount * Math.sin((2 * Math.PI * (frame + phase)) / period)
}
