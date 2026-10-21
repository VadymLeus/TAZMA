// src/diagnostics/frameCounter.ts

export interface FrameLike {
  close(): void
  allocationSize?: () => number
  codedWidth?: number
  codedHeight?: number
}

export interface FrameCounts {
  // Frames open now, and the memory they hold.
  live: number
  liveBytes: number
  // Highest values since the counter was created.
  peakLive: number
  peakBytes: number
  // Highest values since the previous sample() call.
  windowLive: number
  windowBytes: number
  // Frames seen in total.
  opened: number
}

type Constructor = new (...args: any[]) => any

export interface FrameHost {
  VideoDecoder?: Constructor
  VideoFrame?: Constructor
}

function frameBytes(frame: FrameLike): number {
  try {
    const size = frame.allocationSize?.()
    if (typeof size === 'number' && size > 0) return size
  } catch {
    // a frame without a pixel format has no copy size
  }
  return Math.round((frame.codedWidth ?? 0) * (frame.codedHeight ?? 0) * 1.5)
}

// Counts the video frames that are open at any moment, wherever they live: in
// the decoder's output, in the queues of the media library, on the way to the
// encoder. A frame is open from the moment it is created until close() is
// called on it, and it holds its pixels the whole time. The counter wraps
// close() of every frame it sees; install() hooks the decoder and the frame
// constructor so that frames made inside libraries are seen as well.
export class FrameCounter {
  private live = 0
  private bytes = 0
  private peakLive = 0
  private peakBytes = 0
  private windowLive = 0
  private windowBytes = 0
  private opened = 0
  private readonly seen = new WeakSet<object>()
  private restore: (() => void) | null = null

  track<T extends FrameLike>(frame: T): T {
    if (this.seen.has(frame)) return frame
    this.seen.add(frame)
    const size = frameBytes(frame)
    this.live++
    this.bytes += size
    this.opened++
    this.peakLive = Math.max(this.peakLive, this.live)
    this.peakBytes = Math.max(this.peakBytes, this.bytes)
    this.windowLive = Math.max(this.windowLive, this.live)
    this.windowBytes = Math.max(this.windowBytes, this.bytes)
    const close = frame.close.bind(frame)
    let closed = false
    frame.close = () => {
      if (!closed) {
        closed = true
        this.live--
        this.bytes -= size
      }
      close()
    }
    return frame
  }

  counts(): FrameCounts {
    return {
      live: this.live,
      liveBytes: this.bytes,
      peakLive: this.peakLive,
      peakBytes: this.peakBytes,
      windowLive: this.windowLive,
      windowBytes: this.windowBytes,
      opened: this.opened,
    }
  }

  // The counts, then a new window starts from what is open right now.
  sample(): FrameCounts {
    const counts = this.counts()
    this.windowLive = this.live
    this.windowBytes = this.bytes
    return counts
  }

  get installed(): boolean {
    return this.restore !== null
  }

  install(host: FrameHost = globalThis as unknown as FrameHost): void {
    if (this.restore) return
    const counter = this
    const Decoder = host.VideoDecoder
    const Frame = host.VideoFrame
    if (Decoder) {
      host.VideoDecoder = class extends Decoder {
        constructor(init: { output: (frame: FrameLike) => void }) {
          super({
            ...init,
            output: (frame: FrameLike) => {
              counter.track(frame)
              init.output(frame)
            },
          })
        }
      }
    }
    if (Frame) {
      host.VideoFrame = class extends Frame {
        constructor(...args: any[]) {
          super(...args)
          counter.track(this as unknown as FrameLike)
        }

        clone() {
          return counter.track(super.clone())
        }

        // Frames made by the browser itself are not of this class.
        static [Symbol.hasInstance](value: unknown) {
          return value instanceof Frame
        }
      }
    }
    this.restore = () => {
      host.VideoDecoder = Decoder
      host.VideoFrame = Frame
    }
  }

  uninstall(): void {
    this.restore?.()
    this.restore = null
  }
}
