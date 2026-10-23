// src/pipeline/gate.ts
import type { FrameLike } from '../diagnostics/frameCounter.ts'
import type { Held } from './flowControl.ts'

type Constructor = new (...args: any[]) => any

export interface GateHost {
  VideoDecoder?: Constructor
}

// What a gate asks of the flow control it serves.
export interface GateOwner {
  claim(): boolean
  hold(gate: Held): void
  unhold(gate: Held): void
  progress(): void
  frameClosed(): void
  release(count: number, measured: boolean): void
  // The limit and the credits in use, in words, for error messages.
  state(): string
}

// Puts a gate in front of every video decoder created while it is installed.
// The media library makes its decoders by itself, so the class they come from
// is replaced for the time of an export, the way the frame counter does it.
// A packet goes into the real decoder only when the flow control has a credit
// for it; the others wait here and count in decodeQueueSize, so the library's
// own feeding loop sees a full queue and stops. Frames that come out carry
// their credit: closing one gives it back unless the consumer handed it on.
export function installGate(owner: GateOwner, host: GateHost): () => void {
  const Base = host.VideoDecoder
  if (!Base) return () => {}

  class GatedVideoDecoder extends Base implements Held {
    private waiting: unknown[] = []
    private sent = 0
    private emitted = 0
    private settled = 0
    // Credits of this decoder that are still out.
    private credits = 0
    private drained: (() => void) | null = null

    constructor(init: { output: (frame: FrameLike) => void; error?: (error: unknown) => void }) {
      const relay: {
        take: ((frame: FrameLike) => void) | null
        explain: ((error: unknown) => unknown) | null
      } = { take: null, explain: null }
      super({
        ...init,
        output: (frame: FrameLike) => {
          relay.take?.(frame)
          init.output(frame)
        },
        error: (error: unknown) => init.error?.(relay.explain ? relay.explain(error) : error),
      })
      relay.take = (frame) => this.take(frame)
      relay.explain = (error) => this.annotateFailure(error)
    }

    // The error of the decoder with the state of the gate added: how many
    // packets wait, and what the limit and the credits were.
    private annotateFailure(error: unknown): unknown {
      if (!(error instanceof Error)) return error
      const wrapped = new Error(
        `${error.message} [конвеєр: чекає ${this.waiting.length}, надіслано ${this.sent}, кадрів видано ${this.emitted}; ${owner.state()}]`,
        { cause: error },
      )
      wrapped.name = error.name
      return wrapped
    }

    private take(frame: FrameLike): void {
      this.emitted++
      owner.progress()
      const close = frame.close.bind(frame)
      let closed = false
      frame.close = () => {
        if (!closed) {
          closed = true
          if (this.credits > 0) {
            this.credits--
            owner.frameClosed()
          }
        }
        close()
      }
    }

    private send(chunk: unknown): void {
      this.sent++
      this.credits++
      super.decode(chunk)
    }

    decode(chunk: unknown): void {
      if (this.waiting.length === 0 && owner.claim()) {
        this.send(chunk)
        return
      }
      this.waiting.push(chunk)
      owner.hold(this)
    }

    drain(): boolean {
      while (this.waiting.length > 0 && owner.claim()) this.send(this.waiting.shift())
      if (this.waiting.length > 0) return false
      this.drained?.()
      this.drained = null
      return true
    }

    lend(): boolean {
      if (this.waiting.length === 0) return false
      this.send(this.waiting.shift())
      if (this.waiting.length === 0) {
        this.drained?.()
        this.drained = null
        owner.unhold(this)
      }
      return true
    }

    get decodeQueueSize(): number {
      return super.decodeQueueSize + this.waiting.length
    }

    async flush(): Promise<void> {
      if (this.waiting.length > 0) {
        owner.hold(this)
        await new Promise<void>((resolve) => {
          this.drained = resolve
        })
      }
      await super.flush()
      // Packets the decoder swallowed without a frame hold credits no frame
      // will ever give back.
      const lost = this.sent - this.emitted - this.settled
      if (lost > 0) {
        this.settled += lost
        this.credits = Math.max(0, this.credits - lost)
        owner.release(lost, false)
      }
    }

    reset(): void {
      this.forget()
      super.reset()
    }

    close(): void {
      this.forget()
      super.close()
    }

    private forget(): void {
      this.waiting.length = 0
      owner.unhold(this)
      this.drained?.()
      this.drained = null
      if (this.credits > 0) {
        const left = this.credits
        this.credits = 0
        owner.release(left, false)
      }
    }
  }

  host.VideoDecoder = GatedVideoDecoder
  return () => {
    host.VideoDecoder = Base
  }
}
