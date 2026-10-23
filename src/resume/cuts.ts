// src/resume/cuts.ts

export const DEFAULT_SEGMENT_SECONDS = 30
const SAME = 1e-9

export type CutAction =
  // The frame lies in a part the journal already holds.
  | 'skip'
  // No part is open: open one for this frame.
  | 'start'
  // The frame belongs to the open part.
  | 'add'
  // The open part ends before this frame: close it, then open the next.
  | 'cut'

export interface Span {
  from: number
  to: number
}

// The number of the stretch of `seconds` a moment falls in. A moment a hair
// short of a boundary counts as being on it, so rounding error in a frame's
// time cannot move a frame into the part before.
export const stretchOf = (time: number, seconds: number): number =>
  Math.floor(time / seconds + SAME)

// Cuts the video into the parts of the journal. A part starts where the one
// before ended and ends at the first boundary of the grid after its first
// frame; the last part ends at the end of the timeline. The cuts depend on
// the times of the frames only, so an export that goes on from a part in the
// journal cuts the rest exactly as an export that never stopped would have.
export class Cutter {
  readonly seconds: number
  readonly total: number
  private end: number
  private open: { from: number; cut: number } | null = null
  private readonly skipBefore: number
  private readonly done: boolean

  // `covered` is the timeline second the closed parts of the journal reach.
  constructor(seconds: number, total: number, covered = 0) {
    if (!(seconds > 0)) throw new Error('Довжина частини журналу має бути додатною.')
    this.seconds = seconds
    this.total = total
    this.end = covered
    this.done = covered >= total - SAME
    this.skipBefore = covered > 0 ? Math.round(covered / seconds) : 0
  }

  get covered(): number {
    return this.end
  }

  get isOpen(): boolean {
    return this.open !== null
  }

  classify(time: number): CutAction {
    if (this.done) return 'skip'
    const stretch = stretchOf(time, this.seconds)
    if (!this.open) return stretch < this.skipBefore ? 'skip' : 'start'
    return stretch >= this.open.cut ? 'cut' : 'add'
  }

  // Opens the part the frame at `time` starts; returns its bounds as far as
  // they are known now.
  start(time: number): Span {
    if (this.open) throw new Error('Частина вже відкрита.')
    this.open = { from: this.end, cut: stretchOf(time, this.seconds) + 1 }
    return { from: this.open.from, to: this.limit(this.open.cut) }
  }

  // Closes the open part. `last` is for the end of the video: the part then
  // reaches the end of the timeline.
  close(last: boolean): Span {
    if (!this.open) throw new Error('Немає відкритої частини.')
    const span = { from: this.open.from, to: last ? this.total : this.limit(this.open.cut) }
    this.open = null
    this.end = span.to
    return span
  }

  private limit(cut: number): number {
    return Math.min(cut * this.seconds, this.total)
  }
}
