// src/export/exportProject.ts
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Output,
  Quality,
  VideoSampleSink,
} from 'mediabunny'
import type { InputAudioTrack, InputVideoTrack, VideoSample } from 'mediabunny'
import { frameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import type { ProjectState, Source } from '../project/types.ts'
import { silenceChunks, trimWindow } from './audio.ts'
import type { TrimWindow } from './audio.ts'
import { remixToStereo, resampleLinear } from './audioFormat.ts'
import { createFormat } from './codecs.ts'
import { composeFrame } from './compose.ts'
import { outputSize } from './geometry.ts'
import { mergeByTime } from './merge.ts'
import { buildSegments } from './plan.ts'
import type { Segment } from './plan.ts'
import { ExportAborted } from './types.ts'
import type { ExportOptions, ExportResult, ExportSettings } from './types.ts'

export type ExportProject = Pick<ProjectState, 'clips' | 'texts' | 'sources'>

const AUDIO_RATE = 48000
const AUDIO_CHANNELS = 2
const MIN_FRAME = 1e-4
const FALLBACK_FRAME = 1 / 30

interface Tracks {
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
}

type VideoItem = { kind: 'video'; time: number; sample: VideoSample; segment: Segment }
type AudioItem = { kind: 'audio'; time: number; sample: AudioSample }
type Item = VideoItem | AudioItem

// Cuts an audio block to the clip and brings it to stereo at 48 kHz, so every
// block fed to the encoder has the same format whatever file it came from.
function fitAudio(sample: AudioSample, window: TrimWindow): AudioSample {
  const whole =
    window.frameOffset === 0 && window.frameCount === sample.numberOfFrames
  if (whole && sample.numberOfChannels === AUDIO_CHANNELS && sample.sampleRate === AUDIO_RATE) {
    sample.setTimestamp(window.timestamp)
    return sample
  }
  const planes: Float32Array[] = []
  for (let plane = 0; plane < sample.numberOfChannels; plane++) {
    const data = new Float32Array(window.frameCount)
    sample.copyTo(data, {
      planeIndex: plane,
      format: 'f32-planar',
      frameOffset: window.frameOffset,
      frameCount: window.frameCount,
    })
    planes.push(data)
  }
  const [left, right] = remixToStereo(planes).map((channel) =>
    resampleLinear(channel, sample.sampleRate, AUDIO_RATE),
  )
  const data = new Float32Array(left.length * AUDIO_CHANNELS)
  data.set(left, 0)
  data.set(right, left.length)
  sample.close()
  return new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_RATE,
    timestamp: window.timestamp,
  })
}

// The plain full re-encode: every frame of every clip is decoded, painted onto
// a canvas (effect, captions) and encoded again, one frame at a time. Audio is
// decoded and encoded again as well.
export async function exportProject(
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

  const inputs = new Map<string, Input>()
  const tracks = new Map<string, Tracks>()
  let output: Output | null = null

  try {
    async function open(source: Source): Promise<void> {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source.file) })
      inputs.set(source.id, input)
      tracks.set(source.id, {
        video: await input.getPrimaryVideoTrack(),
        audio: await input.getPrimaryAudioTrack(),
      })
    }
    for (const segment of segments) {
      const source = sources.find((s) => s.id === segment.clip.sourceId)
      if (!source) throw new Error('Кліп посилається на файл, якого немає в проєкті.')
      if (!inputs.has(source.id)) await open(source)
    }
    const tracksOf = (segment: Segment) => tracks.get(segment.clip.sourceId) as Tracks
    const hasAudio = segments.some((segment) => tracksOf(segment).audio)

    const target = new BufferTarget()
    output = new Output({ format: createFormat(settings.container), target })

    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
    const quality = new Quality(settings.quality)
    const videoSource = new CanvasSource(canvas, { codec: settings.videoCodec, quality })
    output.addVideoTrack(videoSource)
    let audioSource: AudioSampleSource | null = null
    if (hasAudio) {
      audioSource = new AudioSampleSource({ codec: settings.audioCodec, quality })
      output.addAudioTrack(audioSource)
    }
    await output.start()

    async function* videoItems(): AsyncGenerator<Item> {
      for (const segment of segments) {
        const track = tracksOf(segment).video
        if (!track) continue
        const sink = new VideoSampleSink(track)
        for await (const sample of sink.samples(segment.start, segment.end)) {
          const time = segment.offset + Math.max(0, sample.timestamp - segment.start)
          yield { kind: 'video', time, sample, segment }
        }
      }
    }

    async function* audioItems(): AsyncGenerator<Item> {
      if (!hasAudio) return
      for (const segment of segments) {
        const track = tracksOf(segment).audio
        if (!track) {
          const end = segment.offset + segment.length
          for (const chunk of silenceChunks(segment.offset, end, AUDIO_RATE)) {
            const sample = new AudioSample({
              data: new Float32Array(chunk.frames * AUDIO_CHANNELS),
              format: 'f32-planar',
              numberOfChannels: AUDIO_CHANNELS,
              sampleRate: AUDIO_RATE,
              timestamp: chunk.timestamp,
            })
            yield { kind: 'audio', time: chunk.timestamp, sample }
          }
          continue
        }
        const sink = new AudioSampleSink(track)
        for await (const sample of sink.samples(segment.start, segment.end)) {
          const window = trimWindow(
            sample.timestamp,
            sample.numberOfFrames,
            sample.sampleRate,
            segment.start,
            segment.end,
            segment.offset,
          )
          if (!window) {
            sample.close()
            continue
          }
          const fitted = fitAudio(sample, window)
          yield { kind: 'audio', time: fitted.timestamp, sample: fitted }
        }
      }
    }

    let frames = 0
    const merged = mergeByTime<Item>([videoItems(), audioItems()], (item) => item.sample.close())
    for await (const item of merged) {
      if (signal?.aborted) {
        item.sample.close()
        throw new ExportAborted()
      }
      try {
        if (item.kind === 'video') {
          const { segment, sample, time } = item
          const natural = sample.duration > 0 ? sample.duration : FALLBACK_FRAME
          const duration = Math.min(natural, segment.offset + segment.length - time)
          if (duration < MIN_FRAME) continue
          composeFrame(ctx, size.width, size.height, sample, segment.clip.effect, texts, time)
          await videoSource.add(time, duration)
          frames++
          onProgress?.({ time: time + duration, total, frames })
        } else if (audioSource) {
          await audioSource.add(item.sample)
        }
      } finally {
        item.sample.close()
      }
    }

    videoSource.close()
    audioSource?.close()
    await output.finalize()

    const buffer = target.buffer
    if (!buffer) throw new Error('Експорт не створив файл.')
    const mimeType = await output.getMimeType()
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
      bytes: buffer.byteLength,
      elapsedMs: performance.now() - startedAt,
      frames,
      width: size.width,
      height: size.height,
      duration: total,
      hasAudio,
      settings,
    }
  } catch (error) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {})
    }
    throw error
  } finally {
    for (const input of inputs.values()) input.dispose()
  }
}
