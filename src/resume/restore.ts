// src/resume/restore.ts
import type { ExportProject, ExportSettings } from '../export/types.ts'
import type { MediaInfo } from '../media/probe.ts'
import type { Source } from '../project/types.ts'
import { OUTPUT_KEYS } from './fingerprint.ts'
import type { Recipe, SourceRef } from './manifest.ts'

// A source the journal needs and the person has not given back, with a file of
// the same name if there is one (the file changed, or it is another one).
export interface MissingSource {
  ref: SourceRef
  sameName: File | null
}

const sameFile = (ref: SourceRef, file: File): boolean =>
  file.name === ref.name && file.size === ref.size && file.lastModified === ref.lastModified

// Finds each source of the journal among the files the person picked. A file
// is the same if its name, size and modification time are; a copy that has a
// new date counts as another file, since there is no telling what changed.
export function matchSources(
  refs: SourceRef[],
  files: File[],
): { matched: Map<string, File>; missing: MissingSource[] } {
  const matched = new Map<string, File>()
  const missing: MissingSource[] = []
  for (const ref of refs) {
    const file = files.find((candidate) => sameFile(ref, candidate))
    if (file) matched.set(ref.id, file)
    else missing.push({ ref, sameName: files.find((candidate) => candidate.name === ref.name) ?? null })
  }
  return { matched, missing }
}

// The project an export was started from, built again from the recipe in the
// journal and the files picked anew. `probe` reads a file's tracks, as on
// import. Nothing is returned while a file is missing.
export async function restoreProject(
  recipe: Recipe,
  files: File[],
  probe: (file: File) => Promise<MediaInfo>,
): Promise<{ project: ExportProject; missing: [] } | { project: null; missing: MissingSource[] }> {
  const { matched, missing } = matchSources(recipe.sources, files)
  if (missing.length > 0) return { project: null, missing }
  const sources: Source[] = []
  for (const ref of recipe.sources) {
    const file = matched.get(ref.id) as File
    sources.push({ id: ref.id, file, url: '', info: await probe(file) })
  }
  return { project: { clips: recipe.clips, texts: recipe.texts, sources }, missing: [] }
}

// The settings to go on with: whatever shapes the output is what the export
// was started with, the rest (frame limit, thread, memory readings) is what
// the person has chosen now.
export function mergeSettings(recorded: ExportSettings, current: ExportSettings): ExportSettings {
  const merged: ExportSettings = { ...current, resumable: true }
  for (const key of OUTPUT_KEYS) (merged as unknown as Record<string, unknown>)[key] = recorded[key]
  if (recorded.segmentSeconds !== undefined) merged.segmentSeconds = recorded.segmentSeconds
  return merged
}

// A sentence about a missing source, for the person.
export function missingText(item: MissingSource): string {
  const { ref, sameName } = item
  if (!sameName) return `Потрібен файл «${ref.name}».`
  return `Файл «${ref.name}» не збігається з тим, що був у експорті (розмір чи дата зміни інші).`
}
