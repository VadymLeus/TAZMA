// src/export/exportSelective.ts
import {
  AudioSampleSource,
  CanvasSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  NullTarget,
  Output,
  Quality,
  VideoSampleSink,
} from 'mediabunny'
import type { AudioSample, EncodedPacket, InputVideoTrack, VideoSample } from 'mediabunny'
import { frameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import { ParameterRegistry, startsWithIdr } from './avcSets.ts'
import { createFormat } from './codecs.ts'
import { createSink } from './sink.ts'
import type { ResultSink } from './sink.ts'
import { composeFrame } from './compose.ts'
import { isClosedGop } from './gop.ts'
import { outputSize } from './geometry.ts'
import { mergeByTime } from './merge.ts'
import { buildSegments } from './plan.ts'
import type { Segment } from './plan.ts'
import { analyzeProject, toBytes } from './selectiveAnalysis.ts'
import { planSelective } from './selectivePlan.ts'
import type { Piece } from './selectivePlan.ts'
import { FALLBACK_FRAME, MIN_FRAME, audioItems, openProject } from './shared.ts'
import type { AudioItem } from './shared.ts'
import { ExportAborted } from './types.ts'
import type { ExportOptions, ExportProject, ExportResult, ExportSettings } from './types.ts'

const EPS = 1e-6
const ENCODER = 'encoder'

type FrameItem = { kind: 'frame'; time: number; sample: VideoSample; segment: Segment }
type PacketItem = { kind: 'packet'; time: number; packet: EncodedPacket }
type Item = FrameItem | PacketItem | AudioItem

interface Run {
  output: Output
  source: CanvasSource
}

// Selective export. Whole GOPs that no effect or caption touches travel from
// the source file to the output as packets, without decoding. Everything else
// is decoded, painted and encoded again, in separate encoder sessions that
// each start with a key frame, so no encoded frame refers to a copied one.
// Audio is always encoded again.
export async function exportSelective(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { clips, texts, sources } = project
  const { signal, onProgress } = options
  const total = timelineDuration(clips)
  if (clips.length === 0 || total <= 0) throw new Error('Таймлайн порожній.')

  const size = outputSize(frameSize(clips, sources), settings.height)
  const segments = buildSegments(clips)
  const startedAt = performance.now()
  let output: Output | null = null
  let sink: ResultSink | null = null
  let run: Run | null = null
  const opened = await openProject(project, segments)

  try {
    const analysis = await analyzeProject(segments, opened, settings, size, signal)
    let pieces = planSelective(segments, texts, analysis.analyses)
    const { hasAudio } = opened

    // H.264 from several files shares one track: every set the output uses
    // is written into its description under a number of its own.
    let registry: ParameterRegistry | null = null
    if (settings.videoCodec === 'avc') {
      const encoderStream = { key: ENCODER, description: analysis.encoder.description }
      const used = new Set<string>()
      for (const piece of pieces) {
        if (piece.kind === 'copy') used.add(segments[piece.segment].clip.sourceId)
      }
      registry = ParameterRegistry.create([
        ...[...used].map((id) => ({ key: id, description: analysis.streams.get(id)?.description })),
        encoderStream,
      ])
      if (!registry) {
        for (const item of analysis.analyses) item.copyable = false
        pieces = planSelective(segments, texts, analysis.analyses)
        registry = ParameterRegistry.create([encoderStream])
      }
    }
    const videoConfig: VideoDecoderConfig = registry
      ? { ...analysis.encoder.config, codec: registry.codecString, description: registry.description }
      : analysis.encoder.config

    sink = await createSink(settings.container)
    output = new Output({ format: createFormat(settings.container, !sink.onDisk), target: sink.target })
    const videoSource = new EncodedVideoPacketSource(settings.videoCodec)
    output.addVideoTrack(videoSource)
    const quality = new Quality(settings.quality)
    let audioSource: AudioSampleSource | null = null
    if (hasAudio) {
      audioSource = new AudioSampleSource({ codec: settings.audioCodec, quality })
      output.addAudioTrack(audioSource)
    }
    await output.start()

    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')

    // Every video packet, copied or freshly encoded, goes through one queue so
    // the track receives them in the order they were produced.
    let queue: Promise<void> = Promise.resolve()
    let described = false
    let rewritten = 0
    // A problem met inside an encoder callback, raised by the main loop.
    let failure: unknown = null
    const check = () => {
      if (failure) throw failure
    }
    const sendPacket = (packet: EncodedPacket): Promise<void> => {
      const meta = described ? undefined : { decoderConfig: videoConfig }
      described = true
      queue = queue.then(() => videoSource.add(packet, meta))
      return queue
    }

    // Moves a packet of the stream called key onto the numbers of the
    // output's parameter sets; null when that cannot be done.
    const moveToOutput = (packet: EncodedPacket, key: string): EncodedPacket | null => {
      if (!registry) return packet
      const data = registry.rewrite(key, packet.data)
      if (!data) return null
      return data === packet.data ? packet : packet.clone({ data })
    }

    const stats = {
      mode: 'selective' as const,
      framesCopied: 0,
      framesRecoded: 0,
      copiedSeconds: 0,
      recodedSeconds: 0,
      runs: 0,
      fallbackGops: 0,
      rewrittenPackets: 0,
    }

    async function startRun(): Promise<Run> {
      const runOutput = new Output({
        format: createFormat(settings.container, false),
        target: new NullTarget(),
      })
      let first = true
      const source = new CanvasSource(canvas, {
        codec: settings.videoCodec,
        quality,
        onEncodedPacket: (packet, meta) => {
          // The output's description was fixed with the first packet, so a
          // session that comes back with other parameter sets cannot be used.
          const reported = toBytes(meta?.decoderConfig?.description)
          if (first && registry && reported && !registry.matches(ENCODER, reported)) {
            failure ??= new Error(
              'Кодувальник повернув інші параметри H.264 у новому сеансі. Спробуйте повне перекодування.',
            )
          }
          first = false
          const own = packet.clone()
          const moved = moveToOutput(own, ENCODER)
          if (!moved) {
            failure ??= new Error('Не вдалося перенести пакет H.264 у спільний потік.')
            return
          }
          if (moved !== own) rewritten++
          void sendPacket(moved)
        },
      })
      runOutput.addVideoTrack(source)
      await runOutput.start()
      stats.runs++
      return { output: runOutput, source }
    }

    async function endRun(): Promise<void> {
      if (!run) return
      const finished = run
      run = null
      finished.source.close()
      await finished.output.finalize()
      await queue
    }

    async function* recodeFrames(
      segment: Segment,
      track: InputVideoTrack,
      from: number,
      to: number,
      keepFirst: boolean,
    ): AsyncGenerator<FrameItem> {
      const sink = new VideoSampleSink(track)
      for await (const sample of sink.samples(from, to)) {
        if (!keepFirst && sample.timestamp < from - EPS) {
          sample.close()
          continue
        }
        const time = segment.offset + Math.max(0, sample.timestamp - segment.start)
        yield { kind: 'frame', time, sample, segment }
      }
    }

    // One GOP is read whole before anything is sent: a GOP whose frames reach
    // outside its key frame window (open GOP) is decoded and encoded again.
    async function* copyPackets(
      segment: Segment,
      track: InputVideoTrack,
      piece: Extract<Piece, { kind: 'copy' }>,
    ): AsyncGenerator<FrameItem | PacketItem> {
      const sink = new EncodedPacketSink(track)
      const start = await sink.getKeyPacket(piece.from + EPS)
      const end = piece.toEnd ? null : await sink.getKeyPacket(piece.to + EPS)
      const aligned =
        start !== null &&
        Math.abs(start.timestamp - piece.from) <= EPS &&
        (piece.toEnd || (end !== null && Math.abs(end.timestamp - piece.to) <= EPS))
      if (!aligned || !start) {
        yield* recodeFrames(segment, track, piece.from, piece.to, false)
        return
      }

      // A GOP that can be copied, with its packets moved onto the output's
      // parameter sets; null when it has to be encoded again. An H.264 GOP
      // has to start with an IDR picture, the only one that may switch the
      // sequence parameter set.
      const readyGop = (gop: EncodedPacket[], from: number, until: number): EncodedPacket[] | null => {
        if (!isClosedGop(gop.map((packet) => packet.timestamp), from, until, EPS)) return null
        if (!registry) return gop
        const head = gop[0]
        if (!head || !startsWithIdr(head.data, registry.lengthSize)) return null
        const moved: EncodedPacket[] = []
        let changed = 0
        for (const packet of gop) {
          const next = moveToOutput(packet, segment.clip.sourceId)
          if (!next) return null
          if (next !== packet) changed++
          moved.push(next)
        }
        rewritten += changed
        return moved
      }

      const sendGop = async function* (
        gop: EncodedPacket[],
        from: number,
        until: number,
      ): AsyncGenerator<FrameItem | PacketItem> {
        const ready = readyGop(gop, from, until)
        if (!ready) {
          stats.fallbackGops++
          yield* recodeFrames(segment, track, from, Math.min(until, piece.to), false)
          return
        }
        for (const packet of ready) {
          const time = Math.max(segment.offset, segment.offset + packet.timestamp - segment.start)
          yield { kind: 'packet', time, packet: packet.clone({ timestamp: time }) }
        }
      }

      let gop: EncodedPacket[] = []
      let gopStart = start.timestamp
      for await (const packet of sink.packets(start, end ?? undefined)) {
        if (packet.type === 'key' && gop.length > 0) {
          yield* sendGop(gop, gopStart, packet.timestamp)
          gop = []
          gopStart = packet.timestamp
        }
        gop.push(packet)
      }
      if (gop.length > 0) {
        yield* sendGop(gop, gopStart, piece.toEnd ? Infinity : piece.to)
      }
    }

    async function* videoItems(): AsyncGenerator<FrameItem | PacketItem> {
      for (const piece of pieces) {
        const segment = segments[piece.segment]
        const track = opened.tracksOf(segment).video
        if (!track) continue
        if (piece.kind === 'copy') {
          yield* copyPackets(segment, track, piece)
        } else {
          const first = piece.from <= segment.start + EPS
          yield* recodeFrames(segment, track, piece.from, piece.to, first)
        }
      }
    }

    const dispose = (item: Item) => {
      if (item.kind !== 'packet') (item.sample as VideoSample | AudioSample).close()
    }

    let frames = 0
    const merged = mergeByTime<Item>([videoItems(), audioItems(segments, opened)], dispose)
    for await (const item of merged) {
      check()
      if (signal?.aborted) {
        dispose(item)
        throw new ExportAborted()
      }
      if (item.kind === 'audio') {
        try {
          await audioSource?.add(item.sample)
        } finally {
          item.sample.close()
        }
      } else if (item.kind === 'packet') {
        await endRun()
        const { packet, time } = item
        await sendPacket(packet)
        frames++
        stats.framesCopied++
        stats.copiedSeconds += packet.duration
        onProgress?.({ time: time + packet.duration, total, frames })
      } else {
        try {
          const { segment, sample, time } = item
          const natural = sample.duration > 0 ? sample.duration : FALLBACK_FRAME
          const duration = Math.min(natural, segment.offset + segment.length - time)
          if (duration < MIN_FRAME) continue
          run ??= await startRun()
          composeFrame(ctx, size.width, size.height, sample, segment.clip.effect, texts, time)
          await run.source.add(time, duration)
          frames++
          stats.framesRecoded++
          stats.recodedSeconds += duration
          onProgress?.({ time: time + duration, total, frames })
        } finally {
          item.sample.close()
        }
      }
    }

    await endRun()
    await queue
    check()
    stats.rewrittenPackets = rewritten
    audioSource?.close()
    videoSource.close()
    await output.finalize()

    const mimeType = await output.getMimeType()
    const blob = await sink.finish(mimeType)
    const finished = sink
    return {
      blob,
      mimeType,
      bytes: blob.size,
      elapsedMs: performance.now() - startedAt,
      frames,
      width: size.width,
      height: size.height,
      duration: total,
      hasAudio,
      settings,
      stats,
      release: () => finished.discard(),
    }
  } catch (error) {
    const pending: Output | null = run ? (run as Run).output : null
    if (pending && pending.state !== 'finalized' && pending.state !== 'canceled') {
      await pending.cancel().catch(() => {})
    }
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {})
    }
    await sink?.discard()
    throw error
  } finally {
    opened.dispose()
  }
}
