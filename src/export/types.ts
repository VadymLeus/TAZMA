// src/export/types.ts
import type { AudioCodec, VideoCodec } from 'mediabunny'
import type { MemoryTrace } from '../diagnostics/memoryTrace.ts'
import type { UiStats } from '../diagnostics/responsiveness.ts'
import type { FlowControl, FlowReport } from '../pipeline/flowControl.ts'
import type { ProjectState } from '../project/types.ts'
import type { JournalStore } from '../resume/store.ts'
import type { ExportAttempt, FailedAttempt } from './attempts.ts'

// Containers the video encoders write into; GIF has its own encoder.
export type VideoContainer = 'mp4' | 'webm'
export type Container = VideoContainer | 'gif'
export type QualityLevel = 'low' | 'medium' | 'high'
// full: every frame is decoded and encoded again; selective: untouched whole
// GOPs are copied as packets and only the rest is encoded again.
export type ExportMode = 'full' | 'selective'
// How the frames in the pipeline are limited: library leaves it to the media
// library's own queues, auto works the limit out from a measurement, fixed
// takes the number the user gives.
export type FlowChoice = 'library' | 'auto' | 'fixed'

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
  // GIF only: frames per second, error-diffusion dithering, endless loop.
  gifFps: number
  gifDither: boolean
  gifLoop: boolean
  flow: FlowChoice
  // The limit N of the fixed choice, in frames.
  flowLimit: number
  // Memory the frames of the auto choice may hold, in MiB.
  memoryBudget: number
  // Count the frames held in memory during the export and keep the readings.
  recordMemory: boolean
  // Run the export in a worker, off the page's own thread. Missing (settings
  // kept from before) counts as on.
  inWorker?: boolean
  // Write the encoded output into a journal in the private storage as it is
  // made, so that an interrupted export can go on from the last finished part.
  resumable?: boolean
  // Length of one part of that journal, in timeline seconds.
  segmentSeconds?: number
}

// Settings of an export that goes through the video encoders.
export type VideoSettings = ExportSettings & { container: VideoContainer }

export const isVideoSettings = (settings: ExportSettings): settings is VideoSettings =>
  settings.container !== 'gif'

// The stages of an export that goes through a journal.
export type ExportPhase = 'audio' | 'video' | 'assemble'

export interface ExportProgress {
  // Timeline seconds already encoded and the full length.
  time: number
  total: number
  frames: number
  // Set by exports that go through a journal; the time then counts within it.
  phase?: ExportPhase
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

// What the journal of a resumable export did.
export interface JournalReport {
  job: string
  segments: number
  segmentSeconds: number
  // Timeline seconds that were already in the journal when this run began.
  resumedFrom: number
  // Bytes of encoded packets the journal holds.
  journalBytes: number
  // Parts and manifests written by this run.
  commits: number
  // Time spent writing and committing them, and time spent closing a part
  // altogether (the encoder's last frames included), in milliseconds.
  commitMs: number
  checkpointMs: number
  // Time of the stages of this run, in milliseconds.
  audioMs: number
  videoMs: number
  assembleMs: number
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
  // Things that went wrong without stopping the export, for the person to see.
  notes?: string[]
  // Name of the file in the private storage, when the result is kept there.
  file?: string | null
  // Where the export ran, and how often the page froze while it did.
  thread?: 'worker' | 'main'
  ui?: UiStats | null
  settings: ExportSettings
  stats: ExportStats
  // What the frame limit was and how it worked; null without a limit.
  flow?: FlowReport | null
  // Set when the decoder failed and the export was run again another way: the
  // attempts that failed and the one that gave this result.
  fallback?: { failed: FailedAttempt[]; used: ExportAttempt } | null
  // Readings of the memory held by frames; null when they were not asked for.
  memory?: MemoryTrace | null
  // Set when the export went through a journal.
  journal?: JournalReport | null
  // Frees the file when the result is no longer needed.
  release: () => Promise<void>
}

// The journal an export writes into.
export interface JournalOptions {
  job: string
  store: JournalStore
  // Go on with what the store holds when it belongs to this export; a store
  // that holds something else is an error.
  resume?: boolean
  // How far the files that are gone on from are checked: by size (the default;
  // enough within one run) or end to end, which reads them all.
  depth?: 'size' | 'full'
  // Called when the journal is of no more use: the export finished or was
  // cancelled. An export that failed keeps its journal.
  discard?: () => Promise<void>
}

export interface ExportOptions {
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
  // The frame limit of this export, when there is one.
  flow?: FlowControl | null
  // Where a resumable export writes its journal.
  journal?: JournalOptions | null
  // Go on with the export whose journal this job names in the private
  // storage. The settings must be the ones it was started with, as far as they
  // shape the output.
  resumeJob?: string
}

export class ExportAborted extends Error {
  constructor() {
    super('Експорт скасовано')
    this.name = 'AbortError'
  }
}
