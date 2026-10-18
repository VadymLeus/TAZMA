// src/export/shared.ts
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  BlobSource,
  Input,
} from 'mediabunny'
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny'
import type { Source } from '../project/types.ts'
import { silenceChunks, trimWindow } from './audio.ts'
import type { TrimWindow } from './audio.ts'
import { remixToStereo, resampleLinear } from './audioFormat.ts'
import type { Segment } from './plan.ts'
import type { ExportProject } from './types.ts'

export const AUDIO_RATE = 48000
export const AUDIO_CHANNELS = 2
export const MIN_FRAME = 1e-4
export const FALLBACK_FRAME = 1 / 30

export interface Tracks {
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
}

export interface OpenedProject {
  tracksOf: (segment: Segment) => Tracks
  hasAudio: boolean
  dispose: () => void
}

// Opens each source file once and finds its main video and audio tracks.
export async function openProject(
  project: ExportProject,
  segments: Segment[],
): Promise<OpenedProject> {
  const inputs = new Map<string, Input>()
  const tracks = new Map<string, Tracks>()
  const dispose = () => {
    for (const input of inputs.values()) input.dispose()
  }
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
      const source = project.sources.find((s) => s.id === segment.clip.sourceId)
      if (!source) throw new Error('Кліп посилається на файл, якого немає в проєкті.')
      if (!inputs.has(source.id)) await open(source)
    }
  } catch (error) {
    dispose()
    throw error
  }
  const tracksOf = (segment: Segment) => tracks.get(segment.clip.sourceId) as Tracks
  return {
    tracksOf,
    hasAudio: segments.some((segment) => tracksOf(segment).audio),
    dispose,
  }
}

export type AudioItem = { kind: 'audio'; time: number; sample: AudioSample }

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

// The audio of the whole timeline, clip by clip: decoded, trimmed to the clip,
// moved to its place and normalized; silence stands in for clips without sound.
export async function* audioItems(
  segments: Segment[],
  opened: OpenedProject,
): AsyncGenerator<AudioItem> {
  if (!opened.hasAudio) return
  for (const segment of segments) {
    const track = opened.tracksOf(segment).audio
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
