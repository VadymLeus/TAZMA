// src/diagnostics/decoderTrace.ts

type Constructor = new (...args: any[]) => any

export interface TraceHost {
  VideoDecoder?: Constructor
  AudioDecoder?: Constructor
}

export interface TraceOptions {
  // Ask the browser for software video decoding.
  software: boolean
}

interface ChunkLike {
  type?: string
  timestamp?: number
}

// Puts a recorder in front of every decoder made while it is installed. The
// media library makes the decoders itself, and what the browser says when one
// fails is only "Decoding error". The recorder adds which decoder it was, its
// settings, and how far it got, so that the error says where it happened.
// With `software` the video decoders are asked to work in software, which is
// the way round a hardware decoder that fails.
export function installDecoderTrace(host: TraceHost, options: TraceOptions): () => void {
  const originals = { VideoDecoder: host.VideoDecoder, AudioDecoder: host.AudioDecoder }
  if (originals.VideoDecoder) host.VideoDecoder = traced(originals.VideoDecoder, 'відео', options)
  if (originals.AudioDecoder) host.AudioDecoder = traced(originals.AudioDecoder, 'звук', options)
  return () => {
    host.VideoDecoder = originals.VideoDecoder
    host.AudioDecoder = originals.AudioDecoder
  }
}

function traced(Base: Constructor, kind: string, options: TraceOptions): Constructor {
  return class TracedDecoder extends Base {
    private codec = ''
    private hardware = ''
    private fed = 0
    private produced = 0
    private lastType = ''
    private lastStamp = 0
    private readonly born = Date.now()

    constructor(init: { output: (data: unknown) => void; error?: (error: unknown) => void }) {
      const relay: { explain: ((error: unknown) => unknown) | null; count: (() => void) | null } = {
        explain: null,
        count: null,
      }
      super({
        ...init,
        output: (data: unknown) => {
          relay.count?.()
          init.output(data)
        },
        error: (error: unknown) => init.error?.(relay.explain ? relay.explain(error) : error),
      })
      relay.explain = (error) => this.describeFailure(error)
      relay.count = () => {
        this.produced++
      }
    }

    configure(config: { codec?: string; hardwareAcceleration?: string }): void {
      let used = config
      if (options.software && kind === 'відео') used = { ...config, hardwareAcceleration: 'prefer-software' }
      this.codec = used.codec ?? ''
      this.hardware = used.hardwareAcceleration ?? ''
      super.configure(used)
    }

    decode(chunk: ChunkLike): void {
      this.fed++
      this.lastType = chunk.type ?? ''
      this.lastStamp = chunk.timestamp ?? 0
      super.decode(chunk)
    }

    // The names of the members differ from the gate's: it is made on top of
    // this class, and a member of the same name would be taken over by it.
    private describeFailure(error: unknown): unknown {
      if (!(error instanceof Error)) return error
      const where = [
        `декодер: ${kind}`,
        this.codec || 'кодек невідомий',
        this.hardware,
        `пакетів ${this.fed}, виходів ${this.produced}`,
        this.fed > 0
          ? `останній пакет: ${this.lastType === 'key' ? 'ключовий' : 'проміжний'}, ${(this.lastStamp / 1e6).toFixed(2)} с`
          : '',
        `працював ${((Date.now() - this.born) / 1000).toFixed(1)} с`,
      ].filter(Boolean)
      const wrapped = new Error(`${error.name}: ${error.message} (${where.join('; ')})`, { cause: error })
      wrapped.name = error.name
      return wrapped
    }
  }
}
