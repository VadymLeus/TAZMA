// src/resume/session.ts
import { JournalCorrupt } from './corrupt.ts'
import { inspectJournal, readManifest, repaired, sweep, writeManifest } from './journal.ts'
import { newManifest } from './manifest.ts'
import type { Manifest, ManifestInit } from './manifest.ts'
import type { JournalStore } from './store.ts'

// The store holds the journal of another project or of other settings.
export class JournalMismatch extends Error {
  constructor() {
    super('Журнал належить іншому проєкту або іншим налаштуванням експорту.')
    this.name = 'JournalMismatch'
  }
}

export interface OpenedJournal {
  manifest: Manifest
  // True when the manifest was taken from the store, not made new.
  continued: boolean
  // What was lost from the store and what was done about it.
  notes: string[]
}

async function clearStore(store: JournalStore): Promise<void> {
  for (const name of await store.list()) await store.remove(name)
}

// Opens the journal of an export. A new export starts with an empty store. An
// export that goes on takes up the manifest the store holds if it was made for
// the same output: its files are checked (by size, or end to end with `full`),
// the parts that cannot be trusted are dropped together with everything after
// them, and files the manifest does not list are removed.
export async function openJournal(
  store: JournalStore,
  init: ManifestInit,
  resume: boolean,
  depth: 'size' | 'full' = 'size',
): Promise<OpenedJournal> {
  const notes: string[] = []
  let existing: Manifest | null = null
  if (resume) {
    try {
      existing = await readManifest(store)
    } catch (error) {
      if (!(error instanceof JournalCorrupt)) throw error
      notes.push(`${error.message} Експорт почато заново.`)
    }
  }
  if (!existing) {
    await clearStore(store)
    const manifest = newManifest(init)
    await writeManifest(store, manifest)
    return { manifest, continued: false, notes }
  }
  if (existing.fingerprint !== init.fingerprint) throw new JournalMismatch()
  const inspection = await inspectJournal(store, existing, depth)
  const manifest = repaired(existing, inspection)
  if (manifest !== existing) {
    for (const problem of inspection.problems) notes.push(problem)
    notes.push('Пошкоджені частини журналу закодовано заново.')
    await writeManifest(store, manifest)
  }
  await sweep(store, manifest)
  return { manifest, continued: true, notes }
}
