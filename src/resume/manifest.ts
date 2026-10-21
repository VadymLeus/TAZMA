// src/resume/manifest.ts
import type { ExportProject, ExportSettings } from '../export/types.ts'
import type { Clip, TextItem } from '../project/types.ts'
import type { StoredConfig } from './configs.ts'
import { JournalCorrupt } from './corrupt.ts'

export const JOURNAL_VERSION = 1
const SAME = 1e-9

// A source file as the journal remembers it: enough to recognise the file when
// the person picks it again.
export interface SourceRef {
  id: string
  name: string
  size: number
  lastModified: number
}

// The project without its files, so that an export can be started again after
// the page was closed.
export interface Recipe {
  clips: Clip[]
  texts: TextItem[]
  sources: SourceRef[]
  settings: ExportSettings
}

// A stretch of the video that was encoded and written: timeline seconds from
// `from` to `to`, in the file `file`.
export interface SegmentRecord {
  index: number
  file: string
  from: number
  to: number
  packets: number
  bytes: number
  crc: number
  // How many of its packets were taken from a source file as they were (a
  // selective export), and the seconds they make; absent when none was.
  copied?: { packets: number; seconds: number }
}

export interface AudioRecord {
  file: string
  packets: number
  bytes: number
  crc: number
}

// none: the project has no sound; pending: the sound is not encoded yet.
export type AudioState = 'none' | 'pending' | 'done'

export interface Manifest {
  version: number
  job: string
  // What the output depends on: the project, its files and the settings.
  fingerprint: string
  created: number
  updated: number
  // Timeline seconds of the whole project, and the length of one segment.
  total: number
  segmentSeconds: number
  recipe: Recipe | null
  videoConfig: StoredConfig | null
  audioState: AudioState
  audioConfig: StoredConfig | null
  audio: AudioRecord | null
  segments: SegmentRecord[]
  // Things that went wrong without stopping the export (a sound that broke
  // off near its end, say); they go into the result when it is assembled.
  notes: string[]
  // The export reached its end: the segments cover the whole timeline.
  complete: boolean
}

export const MANIFEST_FILE = 'manifest.json'
export const AUDIO_FILE = 'audio.tzs'
export const segmentFile = (index: number) => `video-${String(index).padStart(6, '0')}.tzs`

export function sourceRefs(project: ExportProject): SourceRef[] {
  return project.sources.map((source) => ({
    id: source.id,
    name: source.file.name,
    size: source.file.size,
    lastModified: source.file.lastModified,
  }))
}

export function makeRecipe(project: ExportProject, settings: ExportSettings): Recipe {
  return {
    clips: project.clips,
    texts: project.texts,
    sources: sourceRefs(project),
    settings,
  }
}

export interface ManifestInit {
  job: string
  fingerprint: string
  total: number
  segmentSeconds: number
  recipe: Recipe | null
  hasAudio: boolean
  now: number
}

export function newManifest(init: ManifestInit): Manifest {
  return {
    version: JOURNAL_VERSION,
    job: init.job,
    fingerprint: init.fingerprint,
    created: init.now,
    updated: init.now,
    total: init.total,
    segmentSeconds: init.segmentSeconds,
    recipe: init.recipe,
    videoConfig: null,
    audioState: init.hasAudio ? 'pending' : 'none',
    audioConfig: null,
    audio: null,
    segments: [],
    notes: [],
    complete: false,
  }
}

// The manifest with one more finished segment. Segments follow each other
// without a gap, from the start of the timeline.
export function withSegment(manifest: Manifest, record: SegmentRecord, now: number): Manifest {
  const last = manifest.segments[manifest.segments.length - 1]
  if (record.index !== manifest.segments.length) throw new Error('Номер частини не йде за попередньою.')
  if (Math.abs(record.from - (last ? last.to : 0)) > SAME) throw new Error('Частина не стикується з попередньою.')
  if (!(record.to > record.from)) throw new Error('Частина має нульову довжину.')
  return { ...manifest, updated: now, segments: [...manifest.segments, record] }
}

export function withVideoConfig(manifest: Manifest, config: StoredConfig, now: number): Manifest {
  return { ...manifest, updated: now, videoConfig: config }
}

export function withAudio(
  manifest: Manifest,
  audio: AudioRecord,
  config: StoredConfig | null,
  now: number,
  notes: string[] = [],
): Manifest {
  return {
    ...manifest,
    updated: now,
    audioState: 'done',
    audio,
    audioConfig: config,
    notes: [...manifest.notes, ...notes],
  }
}

export function withComplete(manifest: Manifest, now: number): Manifest {
  return { ...manifest, updated: now, complete: true }
}

// The timeline second the export goes on from: the end of the last segment.
export function resumeTime(manifest: Manifest): number {
  const last = manifest.segments[manifest.segments.length - 1]
  return last ? last.to : 0
}

// The manifest with only the first `count` segments, for when a later one is
// found damaged.
export function keepSegments(manifest: Manifest, count: number): Manifest {
  if (count >= manifest.segments.length) return manifest
  return { ...manifest, complete: false, segments: manifest.segments.slice(0, count) }
}

export const serializeManifest = (manifest: Manifest): string => JSON.stringify(manifest)

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function checkCopied(value: unknown): { packets: number; seconds: number } | undefined {
  if (!isObject(value) || !isNumber(value.packets) || !isNumber(value.seconds)) return undefined
  return { packets: value.packets, seconds: value.seconds }
}

function checkSegment(value: unknown, index: number, from: number): SegmentRecord {
  if (!isObject(value)) throw new JournalCorrupt('Запис частини журналу пошкоджений.')
  const { file, to, packets, bytes, crc } = value
  if (
    value.index !== index ||
    typeof file !== 'string' ||
    !isNumber(value.from) ||
    !isNumber(to) ||
    !isNumber(packets) ||
    !isNumber(bytes) ||
    !isNumber(crc)
  ) {
    throw new JournalCorrupt('Запис частини журналу пошкоджений.')
  }
  if (Math.abs(value.from - from) > SAME || !(to > value.from)) {
    throw new JournalCorrupt('Частини журналу не стикуються.')
  }
  const copied = checkCopied(value.copied)
  return { index, file, from: value.from, to, packets, bytes, crc, ...(copied ? { copied } : {}) }
}

export function parseManifest(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new JournalCorrupt('Журнал не читається.')
  }
  if (!isObject(value)) throw new JournalCorrupt('Журнал не читається.')
  if (value.version !== JOURNAL_VERSION) {
    throw new JournalCorrupt(`Невідома версія журналу: ${String(value.version)}.`)
  }
  const { job, fingerprint, audioState, segments } = value
  if (
    typeof job !== 'string' ||
    typeof fingerprint !== 'string' ||
    !isNumber(value.created) ||
    !isNumber(value.updated) ||
    !isNumber(value.total) ||
    !isNumber(value.segmentSeconds) ||
    (audioState !== 'none' && audioState !== 'pending' && audioState !== 'done') ||
    !Array.isArray(segments) ||
    typeof value.complete !== 'boolean'
  ) {
    throw new JournalCorrupt('Журнал пошкоджений.')
  }
  const list: SegmentRecord[] = []
  let from = 0
  for (const item of segments) {
    const record = checkSegment(item, list.length, from)
    list.push(record)
    from = record.to
  }
  const audio = value.audio
  if (audio !== null && audio !== undefined) {
    if (!isObject(audio) || typeof audio.file !== 'string' || !isNumber(audio.packets) || !isNumber(audio.bytes) || !isNumber(audio.crc)) {
      throw new JournalCorrupt('Запис звуку в журналі пошкоджений.')
    }
  }
  if (audioState === 'done' && !audio) throw new JournalCorrupt('У журналі немає запису звуку.')
  return {
    version: JOURNAL_VERSION,
    job,
    fingerprint,
    created: value.created,
    updated: value.updated,
    total: value.total,
    segmentSeconds: value.segmentSeconds,
    recipe: (value.recipe ?? null) as Recipe | null,
    videoConfig: (value.videoConfig ?? null) as StoredConfig | null,
    audioState,
    audioConfig: (value.audioConfig ?? null) as StoredConfig | null,
    audio: (audio ?? null) as AudioRecord | null,
    segments: list,
    notes: Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === 'string') : [],
    complete: value.complete,
  }
}
