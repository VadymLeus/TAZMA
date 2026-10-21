// tests/decoderTrace.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { installDecoderTrace } from '../src/diagnostics/decoderTrace.ts'
import { FlowControl } from '../src/pipeline/flowControl.ts'

class FakeDecoder {
  static made: FakeDecoder[] = []
  configured: unknown[] = []
  chunks: unknown[] = []
  private readonly output: (data: unknown) => void
  private readonly onError: ((error: unknown) => void) | undefined
  constructor(init: { output: (data: unknown) => void; error?: (error: unknown) => void }) {
    this.output = init.output
    this.onError = init.error
    FakeDecoder.made.push(this)
  }
  configure(config: unknown) {
    this.configured.push(config)
  }
  decode(chunk: unknown) {
    this.chunks.push(chunk)
  }
  emit() {
    this.output({})
  }
  fail(error: unknown) {
    this.onError?.(error)
  }
}

type Ctor = new (...args: any[]) => any

function host() {
  return { VideoDecoder: FakeDecoder as unknown as Ctor, AudioDecoder: class extends FakeDecoder {} as unknown as Ctor }
}

function failure(): Error {
  const error = new Error('Decoding error.')
  error.name = 'EncodingError'
  return error
}

describe('decoder trace', () => {
  it('adds the kind, codec, progress and last packet to a decoder error', () => {
    FakeDecoder.made = []
    const h = host()
    const stop = installDecoderTrace(h, { software: false })
    const seen: unknown[] = []
    const decoder = new h.VideoDecoder({ output: () => {}, error: (e: unknown) => seen.push(e) })
    decoder.configure({ codec: 'avc1.640028', hardwareAcceleration: 'prefer-hardware' })
    decoder.decode({ type: 'key', timestamp: 2_500_000 })
    decoder.decode({ type: 'delta', timestamp: 2_533_000 })
    ;(FakeDecoder.made[0] as FakeDecoder).emit()
    ;(FakeDecoder.made[0] as FakeDecoder).fail(failure())
    const error = seen[0] as Error
    assert.equal(error.name, 'EncodingError')
    assert.match(error.message, /Decoding error\./)
    assert.match(error.message, /декодер: відео/)
    assert.match(error.message, /avc1\.640028/)
    assert.match(error.message, /prefer-hardware/)
    assert.match(error.message, /пакетів 2, виходів 1/)
    assert.match(error.message, /проміжний, 2\.53 с/)
    stop()
  })

  it('tells a failed audio decoder from a video one', () => {
    FakeDecoder.made = []
    const h = host()
    const stop = installDecoderTrace(h, { software: false })
    const seen: unknown[] = []
    new h.AudioDecoder({ output: () => {}, error: (e: unknown) => seen.push(e) })
    ;(FakeDecoder.made[0] as FakeDecoder).fail(failure())
    assert.match((seen[0] as Error).message, /декодер: звук/)
    assert.match((seen[0] as Error).message, /кодек невідомий/)
    stop()
  })

  it('asks for software video decoding when told to, and leaves audio alone', () => {
    FakeDecoder.made = []
    const h = host()
    const stop = installDecoderTrace(h, { software: true })
    const video = new h.VideoDecoder({ output: () => {} })
    video.configure({ codec: 'avc1.640028' })
    const audio = new h.AudioDecoder({ output: () => {} })
    audio.configure({ codec: 'mp4a.40.2' })
    assert.deepEqual((FakeDecoder.made[0] as FakeDecoder).configured[0], {
      codec: 'avc1.640028',
      hardwareAcceleration: 'prefer-software',
    })
    assert.deepEqual((FakeDecoder.made[1] as FakeDecoder).configured[0], { codec: 'mp4a.40.2' })
    stop()
  })

  it('leaves the decoder as it was once it is removed', () => {
    const h = host()
    const before = h.VideoDecoder
    const stop = installDecoderTrace(h, { software: false })
    assert.notEqual(h.VideoDecoder, before)
    stop()
    assert.equal(h.VideoDecoder, before)
  })

  it('hands on an error that is not an Error as it is', () => {
    FakeDecoder.made = []
    const h = host()
    const stop = installDecoderTrace(h, { software: false })
    const seen: unknown[] = []
    new h.VideoDecoder({ output: () => {}, error: (e: unknown) => seen.push(e) })
    ;(FakeDecoder.made[0] as FakeDecoder).fail('boom')
    assert.deepEqual(seen, ['boom'])
    stop()
  })

  it('gives each of the two, the recorder and the flow gate on top of it, its own say', () => {
    FakeDecoder.made = []
    const h = host()
    const stop = installDecoderTrace(h, { software: false })
    const flow = new FlowControl({
      mode: 'fixed',
      limit: 2,
      budgetBytes: 1e8,
      frameWidth: 16,
      frameHeight: 16,
    })
    flow.install(h)
    const seen: unknown[] = []
    const decoder = new h.VideoDecoder({ output: () => {}, error: (e: unknown) => seen.push(e) })
    decoder.configure({ codec: 'vp09' })
    decoder.decode({ type: 'key', timestamp: 1_000_000 })
    ;(FakeDecoder.made[0] as FakeDecoder).fail(failure())
    const message = (seen[0] as Error).message
    assert.equal(seen.length, 1)
    assert.match(message, /декодер: відео; vp09/)
    assert.equal(message.match(/конвеєр:/g)?.length, 1)
    assert.equal(message.match(/Decoding error\./g)?.length, 1)
    flow.uninstall()
    stop()
  })
})
