// src/export/settings.ts
import type { AudioCodec, VideoCodec } from 'mediabunny'
import type { CodecChoices } from './codecs.ts'
import type { Container, ExportSettings } from './types.ts'

export type ContainerChoices = Record<Container, CodecChoices>

export const CONTAINERS: Container[] = ['mp4', 'webm']

const PREFERRED_VIDEO: Record<Container, VideoCodec> = { mp4: 'avc', webm: 'vp9' }
const PREFERRED_AUDIO: Record<Container, AudioCodec> = { mp4: 'aac', webm: 'opus' }

export const defaultSettings: ExportSettings = {
  mode: 'selective',
  container: 'mp4',
  videoCodec: PREFERRED_VIDEO.mp4,
  audioCodec: PREFERRED_AUDIO.mp4,
  quality: 'medium',
  height: null,
  ignoreColor: false,
}

// Containers in which at least one video codec can be encoded here.
export function availableContainers(choices: ContainerChoices): Container[] {
  return CONTAINERS.filter((container) => choices[container].video.length > 0)
}

function pick<T>(list: T[], wanted: T, current: T): T {
  if (list.includes(current)) return current
  if (list.includes(wanted)) return wanted
  return list[0] ?? current
}

// Brings settings back to values the browser can actually produce.
export function normalizeSettings(
  settings: ExportSettings,
  choices: ContainerChoices,
  heights: number[],
): ExportSettings {
  const containers = availableContainers(choices)
  const container = containers.includes(settings.container)
    ? settings.container
    : (containers[0] ?? settings.container)
  const { video, audio } = choices[container]
  return {
    ...settings,
    container,
    videoCodec: pick(video, PREFERRED_VIDEO[container], settings.videoCodec),
    audioCodec: pick(audio, PREFERRED_AUDIO[container], settings.audioCodec),
    height:
      settings.height !== null && heights.includes(settings.height)
        ? settings.height
        : null,
  }
}

// A new container starts from its own preferred codecs, not the old choice.
export function withContainer(
  settings: ExportSettings,
  container: Container,
): ExportSettings {
  return {
    ...settings,
    container,
    videoCodec: PREFERRED_VIDEO[container],
    audioCodec: PREFERRED_AUDIO[container],
  }
}

export function exportFileName(container: Container): string {
  return `tazma-export.${container}`
}
