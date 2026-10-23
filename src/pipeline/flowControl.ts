// src/pipeline/flowControl.ts
import { CreditPool } from './credits.ts'
import { FlowEstimator } from './estimator.ts'
import type { FlowPhase } from './estimator.ts'
import { installGate } from './gate.ts'
import type { GateHost } from './gate.ts'
import { MAX_LIMIT, fixedBytes, frameBytes, memoryLimit } from './limit.ts'

export type FlowMode = 'auto' | 'fixed'

export interface FlowConfig {
  mode: FlowMode
  // The limit N for the fixed mode.
  limit: number
  // Memory the frames may hold, in bytes, and the size of the biggest frame.
  budgetBytes: number
  frameWidth: number
  frameHeight: number
}

export interface FlowReport {
  mode: FlowMode
  phase: FlowPhase | 'fixed'
  // The limit in force at the end of the export.
  limit: number
  byMemory: number
  byThroughput: number | null
  // The feedback on the limit: tries made, tries kept, and the limit it reached.
  tried: number
  kept: number
  climbedTo: number | null
  // The rate measured at each limit tried, in frames per second.
  trials: { limit: number; rate: number }[]
  // λ in frames per second and W0 in milliseconds, as measured.
  rate: number | null
  latencyMs: number | null
  // The rate the last probe measured, before the later windows could raise λ.
  probeRate: number | null
  // W0 of the first calibration in milliseconds, when a second one replaced it.
  firstLatencyMs: number | null
  margin: number
  budgetBytes: number
  frameBytes: number
  // The part of the budget taken by the encoder's own pictures.
  fixedBytes: number
  // Most frames in the pipeline at once, and how far the limit was exceeded.
  peak: number
  floor: number
  borrowed: number
  // Time during which the entrance was closed, in milliseconds.
  waitedMs: number
  // The limit was dropped because the pipeline kept needing borrowed credits.
  released: boolean
}

export interface FlowClock {
  now(): number
  every(callback: () => void, ms: number): () => void
}

export const realClock: FlowClock = {
  now: () => performance.now(),
  every: (callback, ms) => {
    const id = setInterval(callback, ms)
    return () => clearInterval(id)
  },
}

// What the gate needs from a decoder that waits for credits.
export interface Held {
  // Sends waiting packets for as long as credits last; true when none are left.
  drain(): boolean
  // Sends one waiting packet on a borrowed credit; false when none waits.
  lend(): boolean
}

const TICK_MS = 25
const MIN_STALL_MS = 100
const MAX_STALL_MS = 2000
const FIRST_STALL_MS = 100
// A pipeline that needs this many borrowed credits is not helped by a limit.
const MAX_BORROWED = 24
// Credits lent at the first stall; each stall that follows without progress
// lends twice as many, up to the cap, so a decoder that keeps back many frames
// is found in a few steps and not one packet at a time.
const FIRST_BURST = 1
const MAX_BURST = 8
const MARGIN = 0.25

// Keeps the number of frames in the pipeline under a limit. A frame takes a
// credit when its packet goes into the decoder and gives it back when the
// encoder has produced its packet (or at once, if the frame is dropped). The
// decoders of the media library are fitted with a gate (see gate.ts) that
// holds packets back while no credit is free.
export class FlowControl {
  readonly pool: CreditPool
  private readonly config: FlowConfig
  private readonly clock: FlowClock
  private readonly estimator: FlowEstimator | null
  private readonly byMemory: number
  private readonly size: number
  private held: Held[] = []
  private blockedSince: number | null = null
  private waited = 0
  private floor = 1
  private encoding = 0
  private early = 0
  private transfers = 0
  // When something last moved; null while the pipeline is empty, because the
  // time it stood empty is not a stall and says nothing about its pace.
  private lastProgress: number | null = null
  private events = 0
  private burst = FIRST_BURST
  private gap = FIRST_STALL_MS / 8
  private stopTimer: (() => void) | null = null
  private restore: (() => void) | null = null
  private letGo = false

  constructor(config: FlowConfig, clock: FlowClock = realClock) {
    this.config = config
    this.clock = clock
    this.size = frameBytes(config.frameWidth, config.frameHeight)
    this.byMemory = memoryLimit(config.budgetBytes, config.frameWidth, config.frameHeight)
    this.estimator =
      config.mode === 'auto' ? new FlowEstimator({ memoryLimit: this.byMemory, margin: MARGIN }) : null
    this.pool = new CreditPool(this.target())
  }

  // The limit asked for, before the floor.
  private asked(): number {
    if (this.estimator) return this.estimator.limit
    return Math.max(1, Math.min(this.config.limit, MAX_LIMIT))
  }

  private target(): number {
    return this.letGo ? Infinity : this.asked()
  }

  private apply(): void {
    this.pool.setLimit(Math.max(this.floor, this.target()))
    this.wake()
  }

  install(host: GateHost = globalThis as unknown as GateHost): void {
    if (this.restore) return
    this.restore = installGate(this, host)
  }

  uninstall(): void {
    this.restore?.()
    this.restore = null
    this.stopWatching()
  }

  // A packet wants to go into a decoder.
  claim(): boolean {
    if (!this.pool.tryAcquire()) return false
    this.estimator?.admitted(this.clock.now() / 1000)
    this.progress()
    return true
  }

  hold(gate: Held): void {
    if (!this.held.includes(gate)) this.held.push(gate)
    if (this.blockedSince === null) this.blockedSince = this.clock.now()
    if (this.lastProgress === null) this.lastProgress = this.clock.now()
    if (!this.stopTimer) {
      this.stopTimer = this.clock.every(() => this.watch(), TICK_MS)
    }
  }

  unhold(gate: Held): void {
    const index = this.held.indexOf(gate)
    if (index >= 0) this.held.splice(index, 1)
    if (this.held.length === 0) this.stopWatching()
  }

  private stopWatching(): void {
    if (this.blockedSince !== null) {
      this.waited += this.clock.now() - this.blockedSince
      this.blockedSince = null
    }
    this.stopTimer?.()
    this.stopTimer = null
  }

  // Something moved: a frame came out of a decoder or went into the encoder.
  progress(): void {
    const now = this.clock.now()
    this.events++
    this.burst = FIRST_BURST
    if (this.lastProgress !== null) {
      const gap = Math.min(now - this.lastProgress, MAX_STALL_MS)
      if (gap > 0) this.gap = this.gap * 0.8 + gap * 0.2
    }
    this.lastProgress = this.pool.inFlight > 0 || this.held.length > 0 ? now : null
  }

  // A decoded frame was closed. The consumer calls handOff() just before it
  // closes a frame that went on to the encoder; that frame keeps its credit
  // until the encoder's packet comes out. Any other frame is dropped, and its
  // credit is free at once.
  handOff(): void {
    this.transfers++
  }

  frameClosed(): void {
    if (this.transfers > 0) {
      this.transfers--
      if (this.early > 0) {
        this.early--
        this.release(1, true)
      } else {
        this.encoding++
        this.progress()
      }
      return
    }
    this.release(1, true)
  }

  // The encoder produced packets.
  encoded(count = 1): void {
    const matched = Math.min(count, this.encoding)
    this.encoding -= matched
    this.early += count - matched
    if (matched > 0) this.release(matched, true)
    else this.progress()
  }

  // An encoder session is over: whatever it still owes is given back.
  settle(): void {
    const owed = this.encoding
    this.encoding = 0
    this.early = 0
    this.transfers = 0
    if (owed > 0) this.release(owed, false)
  }

  // Credits come back. `measured` is false for credits that no frame used.
  release(count: number, measured: boolean): void {
    if (count <= 0) return
    this.pool.release(count)
    if (this.estimator) {
      if (measured) {
        const now = this.clock.now() / 1000
        for (let i = 0; i < count; i++) this.estimator.completed(now)
      } else {
        this.estimator.dropped(count)
      }
    }
    this.progress()
    this.apply()
  }

  private wake(): void {
    while (this.held.length > 0 && this.pool.free > 0) {
      const gate = this.held[0] as Held
      if (gate.drain()) this.unhold(gate)
      else if (this.pool.free === 0) break
    }
  }

  // Lends credits when the pipeline has stood still: a decoder keeps frames
  // back until it has seen more packets, an encoder until it has seen more
  // frames, and all credits are inside them. Each stall that follows without
  // progress lends twice as many as the one before. The lender learns from it:
  // the limit never goes below the depth that was needed.
  private watch(): void {
    if (this.held.length === 0) return
    const now = this.clock.now()
    if (this.lastProgress === null) {
      this.lastProgress = now
      return
    }
    const wait = Math.min(MAX_STALL_MS, Math.max(MIN_STALL_MS, this.gap * 8))
    if (now - this.lastProgress < wait) return
    const gate = this.held[0] as Held
    const before = this.events
    const count = this.burst
    let lent = 0
    while (lent < count && this.pool.stats().borrowed < MAX_BORROWED) {
      if (!gate.lend()) break
      this.pool.borrow()
      this.estimator?.admitted(this.clock.now() / 1000)
      lent++
    }
    if (lent === 0) {
      this.unhold(gate)
      return
    }
    this.floor = Math.max(this.floor, this.pool.inFlight)
    this.lastProgress = this.clock.now()
    if (this.events === before) this.burst = Math.min(count * 2, MAX_BURST)
    if (this.pool.stats().borrowed >= MAX_BORROWED) this.letGo = true
    this.apply()
  }

  // The limit and what the pipeline holds, in words.
  state(): string {
    const stats = this.pool.stats()
    const limit = this.letGo ? 'без ліміту' : `ліміт ${Math.max(this.floor, this.asked())}`
    return `${limit}, у конвеєрі ${stats.inFlight}, позичено ${stats.borrowed}`
  }

  // For the memory readings: the limit now and the most frames in the pipeline
  // since the last reading.
  snapshot(): { limit: number; credits: number } {
    return { limit: Math.max(this.floor, this.asked()), credits: this.pool.sample() }
  }

  report(): FlowReport {
    const stats = this.pool.stats()
    const estimator = this.estimator
    return {
      mode: this.config.mode,
      phase: estimator ? estimator.phase : 'fixed',
      limit: Math.max(this.floor, estimator ? estimator.settledLimit : this.asked()),
      byMemory: this.byMemory,
      byThroughput: estimator?.performanceLimit ?? null,
      tried: estimator?.feedback.tried ?? 0,
      kept: estimator?.feedback.kept ?? 0,
      climbedTo: estimator?.feedback.level ?? null,
      trials: estimator?.feedback.trials ?? [],
      rate: estimator?.rate ?? null,
      latencyMs: estimator?.latency != null ? estimator.latency * 1000 : null,
      probeRate: estimator?.probeRate ?? null,
      firstLatencyMs: estimator?.firstLatency != null ? estimator.firstLatency * 1000 : null,
      margin: MARGIN,
      budgetBytes: this.config.budgetBytes,
      frameBytes: this.size,
      fixedBytes: fixedBytes(this.config.frameWidth, this.config.frameHeight),
      peak: stats.peak,
      floor: this.floor,
      borrowed: stats.borrowed,
      waitedMs: this.waited + (this.blockedSince === null ? 0 : this.clock.now() - this.blockedSince),
      released: this.letGo,
    }
  }
}
