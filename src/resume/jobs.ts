// src/resume/jobs.ts
import { JournalCorrupt } from './corrupt.ts'
import { inspectJournal, readManifest, repaired } from './journal.ts'
import { activeJobs } from './lock.ts'
import { resumeTime } from './manifest.ts'
import type { AudioState, SourceRef } from './manifest.ts'
import { listJobs, openJobStore } from './store.ts'
import type { JournalStore } from './store.ts'

// An export the private storage holds a journal of, as the person is shown it.
export interface JobSummary {
  job: string
  created: number
  updated: number
  // Timeline seconds of the whole project, and how far the parts that can be
  // trusted reach.
  total: number
  covered: number
  segments: number
  // Bytes of the parts and of the sound that can be trusted.
  bytes: number
  audio: AudioState
  // The video is all in the journal; only the file is yet to be built.
  complete: boolean
  // The files the person has to pick again.
  sources: SourceRef[]
  // Another export holds this journal right now.
  active: boolean
  // The export can be gone on with: the journal reads and says what it was
  // made from.
  usable: boolean
  // Why not, or what was found wrong (and will be redone).
  problems: string[]
}

function unreadable(job: string, active: boolean, problem: string): JobSummary {
  return {
    job,
    created: 0,
    updated: 0,
    total: 0,
    covered: 0,
    segments: 0,
    bytes: 0,
    audio: 'none',
    complete: false,
    sources: [],
    active,
    usable: false,
    problems: [problem],
  }
}

// What a journal holds. Files are checked by size, which is cheap; a part
// that fails is not counted, since it would be encoded again.
export async function summarizeJob(job: string, store: JournalStore, active = false): Promise<JobSummary> {
  let manifest
  try {
    manifest = await readManifest(store)
  } catch (error) {
    if (error instanceof JournalCorrupt) return unreadable(job, active, error.message)
    throw error
  }
  if (!manifest) return unreadable(job, active, 'У сховищі немає журналу цього експорту.')
  const inspection = await inspectJournal(store, manifest, 'size')
  const kept = repaired(manifest, inspection)
  const recipe = manifest.recipe
  return {
    job,
    created: manifest.created,
    updated: manifest.updated,
    total: manifest.total,
    covered: resumeTime(kept),
    segments: kept.segments.length,
    bytes:
      kept.segments.reduce((sum, record) => sum + record.bytes, 0) +
      (kept.audioState === 'done' ? (kept.audio?.bytes ?? 0) : 0),
    audio: kept.audioState,
    complete: kept.complete,
    sources: recipe?.sources ?? [],
    active,
    usable: recipe !== null,
    problems: recipe ? inspection.problems : [...inspection.problems, 'У журналі немає опису проєкту.'],
  }
}

// The journals in the private storage, the newest first. A journal of an
// export that finished is removed with it, so what is left is an export that
// was cut short, or one that is running now.
export async function listUnfinished(): Promise<JobSummary[]> {
  const [jobs, active] = await Promise.all([listJobs(), activeJobs()])
  const summaries: JobSummary[] = []
  for (const job of jobs) {
    const store = await openJobStore(job, false)
    if (!store) continue
    summaries.push(await summarizeJob(job, store, active.has(job)))
  }
  return summaries.sort((a, b) => b.updated - a.updated)
}
