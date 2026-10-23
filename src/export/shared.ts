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
import { failureAtTail, silenceChunks, trimWindow } from './audio.ts'
import type { TrimWindow } from './audio.ts'
import { remixToStereo, resampleLinear } from './audioFormat.ts'
import { isDecoderError } from './errors.ts'
import type { Segment } from './plan.ts'
import type { ExportProject } from './types.ts'

export const AUDIO_RATE = 48000
export const AUDIO_CHANNELS = 2
export { FALLBACK_FRAME, MIN_FRAME } from './frameTiming.ts'

export interface Tracks {
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
}

export interface OpenedProject {
  tracksOf: (segment: Segment) => Tracks
  // File name of the source of a segment.
  nameOf: (segment: Segment) => string
  hasAudio: boolean
  // What went wrong without stopping the export; goes into the result.
  notes: string[]
  dispose: () => void
}

// Opens each source file once and finds its main video and audio tracks.
export async function openProject(
  project: ExportProject,
  segments: Segment[],
): Promise<OpenedProject> {
  const inputs = new Map<string, Input>()
  const tracks = new Map<string, Tracks>()
  const names = new Map<string, string>()
  const dispose = () => {
    for (const input of inputs.values()) input.dispose()
  }
  try {
    async function open(source: Source): Promise<void> {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source.file) })
      inputs.set(source.id, input)
      names.set(source.id, source.file.name)
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
    nameOf: (segment) => names.get(segment.clip.sourceId) ?? '',
    hasAudio: segments.some((segment) => tracksOf(segment).audio),
    notes: [],
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
    // The end of the sound decoded so far, in source seconds and on the
    // timeline.
    let decodedEnd: number | null = null
    let covered = segment.offset
    try {
      for await (const sample of sink.samples(segment.start, segment.end)) {
        const end = sample.timestamp + sample.numberOfFrames / sample.sampleRate
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
          decodedEnd = end
          continue
        }
        const fitted = fitAudio(sample, window)
        decodedEnd = end
        covered = fitted.timestamp + fitted.numberOfFrames / AUDIO_RATE
        yield { kind: 'audio', time: fitted.timestamp, sample: fitted }
      }
    } catch (error) {
      if (!isDecoderError(error) || !failureAtTail(decodedEnd, segment.end)) throw error
      const name = opened.nameOf(segment)
      opened.notes.push(
        `Звук файлу «${name}» зупинився на ${(decodedEnd as number).toFixed(1).replace('.', ',')} с: декодер видав помилку майже в кінці кліпа. Решту замінено тишею.`,
      )
      const until = segment.offset + segment.length
      for (const chunk of silenceChunks(covered, until, AUDIO_RATE)) {
        const silence = new AudioSample({
          data: new Float32Array(chunk.frames * AUDIO_CHANNELS),
          format: 'f32-planar',
          numberOfChannels: AUDIO_CHANNELS,
          sampleRate: AUDIO_RATE,
          timestamp: chunk.timestamp,
        })
        yield { kind: 'audio', time: chunk.timestamp, sample: silence }
      }
    }
  }
}
