// src/export/settings.ts
import type { AudioCodec, VideoCodec } from 'mediabunny'
import type { CodecChoices } from './codecs.ts'
import type { Container, ExportSettings, VideoContainer } from './types.ts'

export type ContainerChoices = Record<VideoContainer, CodecChoices>

export const VIDEO_CONTAINERS: VideoContainer[] = ['mp4', 'webm']

export const GIF_FPS_CHOICES = [5, 10, 12, 15, 20, 25, 30]
export const GIF_DEFAULT_FPS = 15
// A GIF this tall is already heavy; a smaller frame is suggested first.
export const GIF_COMFORT_HEIGHT = 480

const PREFERRED_VIDEO: Record<VideoContainer, VideoCodec> = { mp4: 'avc', webm: 'vp9' }
const PREFERRED_AUDIO: Record<VideoContainer, AudioCodec> = { mp4: 'aac', webm: 'opus' }

export const defaultSettings: ExportSettings = {
  mode: 'selective',
  container: 'mp4',
  videoCodec: PREFERRED_VIDEO.mp4,
  audioCodec: PREFERRED_AUDIO.mp4,
  quality: 'medium',
  height: null,
  ignoreColor: false,
  gifFps: GIF_DEFAULT_FPS,
  gifDither: true,
  gifLoop: true,
  flow: 'auto',
  flowLimit: 4,
  memoryBudget: 256,
  recordMemory: true,
  inWorker: true,
  resumable: false,
}

export const MEMORY_BUDGETS = [64, 128, 256, 512, 1024, 2048]
export const FLOW_LIMITS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64, 128]

// Containers in which at least one video codec can be encoded here, and GIF,
// which is written without the browser's encoders.
export function availableContainers(choices: ContainerChoices): Container[] {
  const video = VIDEO_CONTAINERS.filter((container) => choices[container].video.length > 0)
  return [...video, 'gif']
}

function pick<T>(list: T[], wanted: T, current: T): T {
  if (list.includes(current)) return current
  if (list.includes(wanted)) return wanted
  return list[0] ?? current
}

function nearestChoice(value: number, choices: number[], fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return choices.reduce((best, choice) =>
    Math.abs(choice - value) < Math.abs(best - value) ? choice : best,
  )
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
  const common = {
    height:
      settings.height !== null && heights.includes(settings.height)
        ? settings.height
        : null,
    gifFps: GIF_FPS_CHOICES.includes(settings.gifFps) ? settings.gifFps : GIF_DEFAULT_FPS,
    flowLimit: nearestChoice(settings.flowLimit, FLOW_LIMITS, defaultSettings.flowLimit),
    memoryBudget: MEMORY_BUDGETS.includes(settings.memoryBudget)
      ? settings.memoryBudget
      : defaultSettings.memoryBudget,
  }
  if (container === 'gif') return { ...settings, ...common, container }
  const { video, audio } = choices[container]
  return {
    ...settings,
    ...common,
    container,
    videoCodec: pick(video, PREFERRED_VIDEO[container], settings.videoCodec),
    audioCodec: pick(audio, PREFERRED_AUDIO[container], settings.audioCodec),
  }
}

// The largest offered height that is not above the comfortable one.
function comfortHeight(heights: number[]): number | null {
  const fitting = heights.filter((height) => height <= GIF_COMFORT_HEIGHT)
  return fitting.length > 0 ? Math.max(...fitting) : null
}

// A new container starts from its own preferred codecs, not the old choice.
// GIF has no codecs; it starts from a smaller frame unless one was chosen.
export function withContainer(
  settings: ExportSettings,
  container: Container,
  heights: number[] = [],
): ExportSettings {
  if (container === 'gif') {
    const keep = settings.height !== null && settings.height <= GIF_COMFORT_HEIGHT
    return {
      ...settings,
      container,
      height: keep ? settings.height : (comfortHeight(heights) ?? settings.height),
    }
  }
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
