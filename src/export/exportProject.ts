// src/export/exportProject.ts
import {
  AudioSampleSource,
  CanvasSource,
  Output,
  Quality,
  VideoSampleSink,
} from 'mediabunny'
import type { AudioSample, VideoSample } from 'mediabunny'
import { frameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import { createFormat } from './codecs.ts'
import { createSink } from './sink.ts'
import type { ResultSink } from './sink.ts'
import { composeFrame } from './compose.ts'
import { outputSize } from './geometry.ts'
import { mergeByTime } from './merge.ts'
import { buildSegments } from './plan.ts'
import type { Segment } from './plan.ts'
import { FALLBACK_FRAME, MIN_FRAME, audioItems, openProject } from './shared.ts'
import type { AudioItem } from './shared.ts'
import { ExportAborted } from './types.ts'
import type { ExportOptions, ExportProject, ExportResult, VideoSettings } from './types.ts'

export type { ExportProject } from './types.ts'

type VideoItem = { kind: 'video'; time: number; sample: VideoSample; segment: Segment }
type Item = VideoItem | AudioItem

const closeItem = (item: { sample: VideoSample | AudioSample }) => item.sample.close()

// The plain full re-encode: every frame of every clip is decoded, painted onto
// a canvas (effect, captions) and encoded again, one frame at a time. Audio is
// decoded and encoded again as well.
export async function exportProject(
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
  const opened = await openProject(project, segments)

  try {
    const { hasAudio } = opened
    sink = await createSink(settings.container)
    output = new Output({ format: createFormat(settings.container, !sink.onDisk), target: sink.target })

    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
    const quality = new Quality(settings.quality)
    const videoSource = new CanvasSource(canvas, {
      codec: settings.videoCodec,
      quality,
      ...(flow ? { onEncodedPacket: () => flow.encoded(1) } : {}),
    })
    output.addVideoTrack(videoSource)
    let audioSource: AudioSampleSource | null = null
    if (hasAudio) {
      audioSource = new AudioSampleSource({ codec: settings.audioCodec, quality })
      output.addAudioTrack(audioSource)
    }
    await output.start()

    async function* videoItems(): AsyncGenerator<Item> {
      for (const segment of segments) {
        const track = opened.tracksOf(segment).video
        if (!track) continue
        const sink = new VideoSampleSink(track)
        for await (const sample of sink.samples(segment.start, segment.end)) {
          const time = segment.offset + Math.max(0, sample.timestamp - segment.start)
          yield { kind: 'video', time, sample, segment }
        }
      }
    }

    let frames = 0
    let encodedSeconds = 0
    const merged = mergeByTime<Item>([videoItems(), audioItems(segments, opened)], closeItem)
    for await (const item of merged) {
      if (signal?.aborted) {
        item.sample.close()
        throw new ExportAborted()
      }
      // A frame that went on to the encoder keeps its place in the pipeline
      // until the encoder has made its packet.
      let handedOn = false
      try {
        if (item.kind === 'video') {
          const { segment, sample, time } = item
          const natural = sample.duration > 0 ? sample.duration : FALLBACK_FRAME
          const duration = Math.min(natural, segment.offset + segment.length - time)
          if (duration < MIN_FRAME) continue
          composeFrame(ctx, size.width, size.height, sample, segment.clip.effect, texts, time)
          await videoSource.add(time, duration)
          handedOn = true
          frames++
          encodedSeconds += duration
          onProgress?.({ time: time + duration, total, frames })
        } else if (audioSource) {
          await audioSource.add(item.sample)
        }
      } finally {
        if (handedOn) flow?.handOff()
        item.sample.close()
      }
    }

    videoSource.close()
    audioSource?.close()
    await output.finalize()
    flow?.settle()

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
      stats: {
        mode: 'full',
        framesCopied: 0,
        framesRecoded: frames,
        copiedSeconds: 0,
        recodedSeconds: encodedSeconds,
        runs: 1,
        fallbackGops: 0,
        rewrittenPackets: 0,
      },
      release: () => finished.discard(),
    }
  } catch (error) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {})
    }
    await sink?.discard()
    throw error
  } finally {
    opened.dispose()
  }
}
