// src/export/types.ts
import type { AudioCodec, VideoCodec } from 'mediabunny'
import type { ProjectState } from '../project/types.ts'

export type Container = 'mp4' | 'webm'
export type QualityLevel = 'low' | 'medium' | 'high'
// full: every frame is decoded and encoded again; selective: untouched whole
// GOPs are copied as packets and only the rest is encoded again.
export type ExportMode = 'full' | 'selective'

export type ExportProject = Pick<ProjectState, 'clips' | 'texts' | 'sources'>

export interface ExportSettings {
  mode: ExportMode
  container: Container
  videoCodec: VideoCodec
  audioCodec: AudioCodec
  quality: QualityLevel
  // Output height in pixels; null keeps the project frame size.
  height: number | null
  // Selective export: copy streams even when their stated colour space is not
  // the one the encoder writes.
  ignoreColor: boolean
}

export interface ExportProgress {
  // Timeline seconds already encoded and the full length.
  time: number
  total: number
  frames: number
}

export interface ExportStats {
  mode: ExportMode
  framesCopied: number
  framesRecoded: number
  copiedSeconds: number
  recodedSeconds: number
  // Separate encoder sessions used for the recoded stretches.
  runs: number
  // Copy runs that turned out to hold an open GOP and were recoded instead.
  fallbackGops: number
  // Times the parameter sets of H.264 were repeated in the stream.
  rewrittenPackets: number
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
  stats: ExportStats
  // Frees the file when the result is no longer needed.
  release: () => Promise<void>
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
