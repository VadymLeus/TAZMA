// src/export/types.ts
import type { AudioCodec, VideoCodec } from 'mediabunny'

export type Container = 'mp4' | 'webm'
export type QualityLevel = 'low' | 'medium' | 'high'

export interface ExportSettings {
  container: Container
  videoCodec: VideoCodec
  audioCodec: AudioCodec
  quality: QualityLevel
  // Output height in pixels; null keeps the project frame size.
  height: number | null
}

export interface ExportProgress {
  // Timeline seconds already encoded and the full length.
  time: number
  total: number
  frames: number
}

export interface ExportResult {
  blob: Blob
  mimeType: string
  bytes: number
  elapsedMs: number
  frames: number
  width: number
  height: number
  duration: number
  hasAudio: boolean
  settings: ExportSettings
}

export interface ExportOptions {
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
}

export class ExportAborted extends Error {
  constructor() {
    super('Експорт скасовано')
    this.name = 'AbortError'
  }
}
