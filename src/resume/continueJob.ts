// src/resume/continueJob.ts
import type { ExportProject, ExportSettings } from '../export/types.ts'
import type { MediaInfo } from '../media/probe.ts'
import { JournalCorrupt } from './corrupt.ts'
import { readManifest } from './journal.ts'
import { mergeSettings, missingText, restoreProject } from './restore.ts'
import type { MissingSource } from './restore.ts'
import { openJobStore } from './store.ts'
import type { JournalStore } from './store.ts'

export interface ContinueDeps {
  // Reads a file's tracks, as on import.
  probe: (file: File) => Promise<MediaInfo>
  open?: (job: string) => Promise<JournalStore | null>
}

export type Continuation =
  | { ok: true; project: ExportProject; settings: ExportSettings }
  | { ok: false; message: string; missing: MissingSource[] }

const refuse = (message: string): Continuation => ({ ok: false, message, missing: [] })

// What it takes to go on with a job: the project built again from the journal's
// recipe and the files picked anew, and the settings the export was started
// with. Fails with a sentence for the person when a file is missing or the
// journal cannot be read.
export async function prepareContinue(
  job: string,
  files: File[],
  current: ExportSettings,
  deps: ContinueDeps,
): Promise<Continuation> {
  const store = await (deps.open ?? ((id) => openJobStore(id, false)))(job)
  if (!store) return refuse('Журнал цього експорту не знайдено у сховищі браузера.')
  let manifest
  try {
    manifest = await readManifest(store)
  } catch (error) {
    if (error instanceof JournalCorrupt) return refuse(error.message)
    throw error
  }
  if (!manifest?.recipe) return refuse('У журналі немає опису проєкту, тому експорт не можна продовжити.')
  const restored = await restoreProject(manifest.recipe, files, deps.probe)
  if (!restored.project) {
    return { ok: false, message: restored.missing.map(missingText).join(' '), missing: restored.missing }
  }
  return { ok: true, project: restored.project, settings: mergeSettings(manifest.recipe.settings, current) }
}
