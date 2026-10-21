// src/pipeline/credits.ts

export interface PoolStats {
  limit: number
  inFlight: number
  // Most credits out at one time.
  peak: number
  // Credits lent above the limit to get a stuck pipeline moving.
  borrowed: number
  // Largest excess over the limit at any time.
  peakOver: number
}

// Counts the frames that are inside the pipeline. A frame takes a credit when
// it enters and gives it back when it leaves, so no more than `limit` frames
// are in flight; borrow() lends one above the limit, for a decoder or encoder
// that holds frames back until it gets more input.
export class CreditPool {
  private cap: number
  private held = 0
  private peak = 0
  private window = 0
  private lent = 0
  private over = 0

  constructor(limit: number) {
    this.cap = CreditPool.normalize(limit)
  }

  private static normalize(limit: number): number {
    if (limit === Infinity) return limit
    return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1
  }

  get limit(): number {
    return this.cap
  }

  get inFlight(): number {
    return this.held
  }

  get free(): number {
    return Math.max(0, this.cap - this.held)
  }

  setLimit(limit: number): void {
    this.cap = CreditPool.normalize(limit)
  }

  tryAcquire(): boolean {
    if (this.held >= this.cap) return false
    this.take()
    return true
  }

  borrow(): void {
    this.take()
    this.lent++
  }

  release(count = 1): void {
    this.held = Math.max(0, this.held - Math.max(0, count))
  }

  private take(): void {
    this.held++
    this.peak = Math.max(this.peak, this.held)
    this.window = Math.max(this.window, this.held)
    if (this.held > this.cap) this.over = Math.max(this.over, this.held - this.cap)
  }

  // The most credits out since the previous call.
  sample(): number {
    const highest = Math.max(this.window, this.held)
    this.window = this.held
    return highest
  }

  stats(): PoolStats {
    return {
      limit: this.cap,
      inFlight: this.held,
      peak: this.peak,
      borrowed: this.lent,
      peakOver: this.over,
    }
  }
}
