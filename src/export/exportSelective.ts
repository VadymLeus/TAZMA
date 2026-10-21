// src/export/exportSelective.ts
import {
  AudioSampleSource,
  CanvasSource,
  EncodedVideoPacketSource,
  NullTarget,
  Output,
  Quality,
} from 'mediabunny'
import type { AudioSample, EncodedPacket, VideoSample } from 'mediabunny'
import { frameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import { createFormat } from './codecs.ts'
import { createSink } from './sink.ts'
import type { ResultSink } from './sink.ts'
import { composeFrame } from './compose.ts'
import { outputSize } from './geometry.ts'
import { mergeByTime } from './merge.ts'
import { buildSegments } from './plan.ts'
import { prepareSelective } from './selectiveSource.ts'
import { FALLBACK_FRAME, MIN_FRAME, audioItems, openProject } from './shared.ts'
import type { AudioItem } from './shared.ts'
import { ExportAborted } from './types.ts'
import type { ExportOptions, ExportProject, ExportResult, VideoSettings } from './types.ts'
import type { VideoItem } from './videoItems.ts'

type Item = VideoItem | AudioItem

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
  settings: VideoSettings,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { clips, texts, sources } = project
  const { signal, onProgress, flow } = options
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
    const selective = await prepareSelective({ segments, texts, opened, settings, size, signal })
    const { hasAudio } = opened
    const videoConfig = selective.videoConfig

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
          flow?.encoded(1)
          if (first) failure ??= selective.sessionProblem(meta)
          first = false
          const own = packet.clone()
          const moved = selective.fromEncoder(own)
          if (!moved) {
            failure ??= new Error('Не вдалося перенести пакет H.264 у спільний потік.')
            return
          }
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
      flow?.settle()
    }

    const dispose = (item: Item) => {
      if (item.kind !== 'packet') (item.sample as VideoSample | AudioSample).close()
    }

    let frames = 0
    const merged = mergeByTime<Item>([selective.items(), audioItems(segments, opened)], dispose)
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
        let handedOn = false
        try {
          const { segment, sample, time } = item
          const natural = sample.duration > 0 ? sample.duration : FALLBACK_FRAME
          const duration = Math.min(natural, segment.offset + segment.length - time)
          if (duration < MIN_FRAME) continue
          run ??= await startRun()
          composeFrame(ctx, size.width, size.height, sample, segment.clip.effect, texts, time)
          await run.source.add(time, duration)
          handedOn = true
          frames++
          stats.framesRecoded++
          stats.recodedSeconds += duration
          onProgress?.({ time: time + duration, total, frames })
        } finally {
          if (handedOn) flow?.handOff()
          item.sample.close()
        }
      }
    }

    await endRun()
    await queue
    check()
    stats.rewrittenPackets = selective.counts.rewritten
    stats.fallbackGops = selective.counts.fallbackGops
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
      notes: opened.notes,
      file: finished.name,
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
