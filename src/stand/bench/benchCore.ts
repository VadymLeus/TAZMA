// src/stand/bench/benchCore.ts
import {
  ALL_FORMATS,
  BlobSource,
  CanvasSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  NullTarget,
  Output,
  Quality,
  VideoSampleSink,
} from 'mediabunny'
import type { InputVideoTrack } from 'mediabunny'
import { composeFrame } from '../../export/compose.ts'
import { createFormat } from '../../export/codecs.ts'
import { createSink } from '../../export/sink.ts'
import { emptyStages, pulled } from '../../export/stageTimes.ts'
import type { StageTimes } from '../../export/stageTimes.ts'
import type { BenchOutput, BenchSpec } from './protocol.ts'

const now = () => performance.now()
// Frames kept as bitmaps to feed the encoder with, and sessions started by
// the session runs.
const POOL = 30
const SESSIONS = 3
const FALLBACK_RATE = 30

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Скасовано.', 'AbortError')
}

interface Opened {
  input: Input
  track: InputVideoTrack
  length: number
  width: number
  height: number
  rate: number
}

async function openFile(file: File, seconds: number): Promise<Opened> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('У файлі немає відео.')
  const full = await input.computeDuration()
  const stats = await track.computePacketStats(50).catch(() => null)
  const rate = stats && stats.averagePacketRate > 0 ? stats.averagePacketRate : FALLBACK_RATE
  return {
    input,
    track,
    length: seconds > 0 ? Math.min(seconds, full) : full,
    width: even(track.displayWidth),
    height: even(track.displayHeight),
    rate,
  }
}

// Frames of the start of the file painted as bitmaps, to feed an encoder with
// real pictures without a decoder running beside it.
async function pool(opened: Opened, count: number): Promise<ImageBitmap[]> {
  const { track, width, height } = opened
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
  const bitmaps: ImageBitmap[] = []
  for await (const sample of new VideoSampleSink(track).samples(0)) {
    try {
      composeFrame(ctx, width, height, sample, undefined, [], 0)
    } finally {
      sample.close()
    }
    bitmaps.push(await createImageBitmap(canvas))
    if (bitmaps.length >= count) break
  }
  if (bitmaps.length === 0) throw new Error('Не вдалося прочитати кадри файлу.')
  return bitmaps
}

function finish(
  began: number,
  stages: StageTimes,
  fields: Pick<BenchOutput, 'frames' | 'bytes' | 'duration'>,
  opened: Opened,
  notes: string[] = [],
): BenchOutput {
  return { ...fields, width: opened.width, height: opened.height, elapsedMs: now() - began, stages, notes }
}

async function read(spec: BenchSpec, signal?: AbortSignal): Promise<BenchOutput> {
  const began = now()
  const stages = emptyStages()
  const opened = await openFile(spec.file, spec.seconds)
  const sink = new EncodedPacketSink(opened.track)
  await sink.getFirstPacket()
  stages.setupMs = now() - began
  let frames = 0
  let bytes = 0
  let last = 0
  const reading = now()
  for await (const packet of sink.packets()) {
    aborted(signal)
    if (packet.timestamp >= opened.length) break
    stages.firstItemMs ??= now() - reading
    frames++
    bytes += packet.data.length
    last = packet.timestamp + packet.duration
  }
  stages.readMs = now() - reading
  return finish(began, stages, { frames, bytes, duration: last }, opened)
}

async function decode(spec: BenchSpec, signal?: AbortSignal): Promise<BenchOutput> {
  const began = now()
  const stages = emptyStages()
  const opened = await openFile(spec.file, spec.seconds)
  stages.setupMs = now() - began
  let frames = 0
  let last = 0
  const decoding = now()
  for await (const sample of new VideoSampleSink(opened.track).samples(0, opened.length)) {
    stages.firstItemMs ??= now() - decoding
    last = sample.timestamp + sample.duration
    sample.close()
    frames++
    aborted(signal)
  }
  stages.decodeMs = now() - decoding
  return finish(began, stages, { frames, bytes: 0, duration: last }, opened)
}

async function copy(spec: BenchSpec, toFile: boolean, signal?: AbortSignal): Promise<BenchOutput> {
  const began = now()
  const stages = emptyStages()
  const opened = await openFile(spec.file, spec.seconds)
  const { track } = opened
  const codec = track.codec
  if (!codec) throw new Error('Невідомий кодек відео файлу.')
  const config = await track.getDecoderConfig()
  const sink = toFile ? await createSink('mp4') : null
  const output = new Output({
    format: createFormat('mp4', false),
    target: sink ? sink.target : new NullTarget(),
  })
  const source = new EncodedVideoPacketSource(codec)
  output.addVideoTrack(source)
  const packets = new EncodedPacketSink(track)
  await packets.getFirstPacket()
  const starting = now()
  await output.start()
  stages.startRunMs = now() - starting
  stages.setupMs = now() - began
  let frames = 0
  let bytes = 0
  let last = 0
  let first = true
  const loop = now()
  try {
    for await (const packet of pulled(packets.packets(), (ms) => (stages.readMs += ms))) {
      aborted(signal)
      if (packet.timestamp >= opened.length) break
      stages.firstItemMs ??= now() - loop
      const sending = now()
      await source.add(packet, first && config ? { decoderConfig: config } : undefined)
      stages.sendMs += now() - sending
      first = false
      frames++
      bytes += packet.data.length
      last = packet.timestamp + packet.duration
    }
    const closing = now()
    source.close()
    await output.finalize()
    if (sink) await sink.finish('video/mp4')
    stages.finishMs = now() - closing
  } finally {
    await sink?.discard()
  }
  return finish(began, stages, { frames, bytes, duration: last }, opened)
}

function encoderSource(canvas: OffscreenCanvas, spec: BenchSpec): { output: Output; source: CanvasSource } {
  const output = new Output({ format: createFormat('mp4', false), target: new NullTarget() })
  const source = new CanvasSource(canvas, { codec: spec.videoCodec, quality: new Quality(spec.quality) })
  output.addVideoTrack(source)
  return { output, source }
}

async function encode(spec: BenchSpec, signal?: AbortSignal): Promise<BenchOutput> {
  const began = now()
  const stages = emptyStages()
  const opened = await openFile(spec.file, spec.seconds)
  const bitmaps = await pool(opened, POOL)
  const canvas = new OffscreenCanvas(opened.width, opened.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
  const total = Math.max(1, Math.round(opened.length * opened.rate))
  const step = 1 / opened.rate
  stages.setupMs = now() - began
  const starting = now()
  const { output, source } = encoderSource(canvas, spec)
  await output.start()
  stages.startRunMs = now() - starting
  const loop = now()
  try {
    for (let index = 0; index < total; index++) {
      aborted(signal)
      const painting = now()
      ctx.drawImage(bitmaps[index % bitmaps.length], 0, 0)
      const encoding = now()
      await source.add(index * step, step)
      const added = now() - encoding
      stages.composeMs += encoding - painting
      stages.encodeMs += added
      stages.firstAddMs ??= added
      stages.firstFrameMs ??= now() - loop
    }
    const closing = now()
    source.close()
    await output.finalize()
    stages.finishMs = now() - closing
  } finally {
    for (const bitmap of bitmaps) bitmap.close()
  }
  return finish(began, stages, { frames: total, bytes: 0, duration: total * step }, opened)
}

// Starts encoder sessions one after another, each given one frame, and times
// the start and the first add. With `busy` the decoder streams frames all the
// while, as it does in an export.
async function sessions(spec: BenchSpec, busy: boolean, signal?: AbortSignal): Promise<BenchOutput> {
  const began = now()
  const stages = emptyStages()
  const opened = await openFile(spec.file, spec.seconds)
  const bitmaps = await pool(opened, 2)
  const canvas = new OffscreenCanvas(opened.width, opened.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
  const step = 1 / opened.rate
  stages.setupMs = now() - began

  let stop = false
  let streaming: Promise<void> = Promise.resolve()
  if (busy) {
    streaming = (async () => {
      for await (const sample of new VideoSampleSink(opened.track).samples(0, opened.length)) {
        sample.close()
        if (stop) break
      }
    })().catch(() => {})
    // Let the decoder get going before the first session starts.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  const firsts: number[] = []
  const loop = now()
  try {
    for (let index = 0; index < SESSIONS; index++) {
      aborted(signal)
      const starting = now()
      const { output, source } = encoderSource(canvas, spec)
      await output.start()
      const started = now()
      ctx.drawImage(bitmaps[0], 0, 0)
      const adding = now()
      await source.add(0, step)
      const added = now()
      source.close()
      await output.finalize()
      const ended = now()
      stages.startRunMs += started - starting
      stages.composeMs += adding - started
      stages.encodeMs += added - adding
      stages.endRunMs += ended - added
      firsts.push(added - adding)
    }
  } finally {
    stop = true
    await streaming
    for (const bitmap of bitmaps) bitmap.close()
  }
  stages.firstAddMs = firsts[0] ?? null
  stages.firstFrameMs = now() - loop
  const notes = [`перший add кожного сеансу, мс: ${firsts.map((ms) => Math.round(ms)).join(' / ')}`]
  return finish(began, stages, { frames: SESSIONS, bytes: 0, duration: SESSIONS * step }, opened, notes)
}

export async function runBench(spec: BenchSpec, signal?: AbortSignal): Promise<BenchOutput> {
  aborted(signal)
  switch (spec.kind) {
    case 'read':
      return read(spec, signal)
    case 'decode':
      return decode(spec, signal)
    case 'copy-null':
      return copy(spec, false, signal)
    case 'copy-file':
      return copy(spec, true, signal)
    case 'encode':
      return encode(spec, signal)
    case 'session':
      return sessions(spec, false, signal)
    case 'session-busy':
      return sessions(spec, true, signal)
  }
}
