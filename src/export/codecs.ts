// src/export/codecs.ts
import {
  Mp4OutputFormat,
  WebMOutputFormat,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
} from 'mediabunny'
import type { AudioCodec, OutputFormat, VideoCodec } from 'mediabunny'
import type { FrameSize } from '../project/frame.ts'
import type { Container } from './types.ts'

const VIDEO_CODECS: VideoCodec[] = ['avc', 'vp9', 'av1']
const AUDIO_CODECS: AudioCodec[] = ['aac', 'opus']

export const VIDEO_LABELS: Record<string, string> = {
  avc: 'H.264',
  vp9: 'VP9',
  av1: 'AV1',
}

export const AUDIO_LABELS: Record<string, string> = {
  aac: 'AAC',
  opus: 'Opus',
}

export const CONTAINER_LABELS: Record<Container, string> = {
  mp4: 'MP4',
  webm: 'WebM',
}

export function createFormat(container: Container): OutputFormat {
  return container === 'mp4'
    ? new Mp4OutputFormat({ fastStart: 'in-memory' })
    : new WebMOutputFormat()
}

export interface CodecChoices {
  video: VideoCodec[]
  audio: AudioCodec[]
}

// Codecs this browser can encode and the container can hold.
export async function availableCodecs(
  container: Container,
  size: FrameSize,
): Promise<CodecChoices> {
  const format = createFormat(container)
  const videoWanted = VIDEO_CODECS.filter((c) => format.getSupportedVideoCodecs().includes(c))
  const audioWanted = AUDIO_CODECS.filter((c) => format.getSupportedAudioCodecs().includes(c))
  const [video, audio] = await Promise.all([
    getEncodableVideoCodecs(videoWanted, { width: size.width, height: size.height }),
    getEncodableAudioCodecs(audioWanted),
  ])
  return { video, audio }
}
