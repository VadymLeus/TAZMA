// src/resume/journal.ts
import { crc32 } from './crc32.ts'
import { JournalCorrupt } from './corrupt.ts'
import { AUDIO_FILE, MANIFEST_FILE, keepSegments, parseManifest, serializeManifest } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { readPacketFile } from './packetFile.ts'
import type { PacketFileStats } from './packetFile.ts'
import type { JournalStore } from './store.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Writes the manifest. This is the commit of the journal: a segment counts
// only once the manifest that lists it is in place.
export async function writeManifest(store: JournalStore, manifest: Manifest): Promise<void> {
  const file = await store.create(MANIFEST_FILE)
  try {
    await file.write(encoder.encode(serializeManifest(manifest)))
    await file.commit()
  } catch (error) {
    await file.abort().catch(() => {})
    throw error
  }
}

// The manifest of the store; null when there is none.
export async function readManifest(store: JournalStore): Promise<Manifest | null> {
  const bytes = await store.read(MANIFEST_FILE)
  if (!bytes) return null
  return parseManifest(decoder.decode(bytes))
}

// Writes one file of packets in one piece (for tests and small files); the
// export itself writes them as they come.
export async function writeWhole(store: JournalStore, name: string, chunks: Uint8Array[]): Promise<void> {
  const file = await store.create(name)
  try {
    for (const chunk of chunks) await file.write(chunk)
    await file.commit()
  } catch (error) {
    await file.abort().catch(() => {})
    throw error
  }
}

export interface Inspection {
  // How many segments from the start can be used.
  usable: number
  audioUsable: boolean
  problems: string[]
}

function matches(stats: PacketFileStats, record: { packets: number; bytes: number; crc: number }): boolean {
  return stats.packets === record.packets && stats.bytes === record.bytes && stats.crc === record.crc
}

// Checks the files the manifest lists. `size` compares file sizes only;
// `full` reads every file and checks it end to end. Segments are used up to
// the first one that fails.
export async function inspectJournal(
  store: JournalStore,
  manifest: Manifest,
  depth: 'size' | 'full' = 'size',
): Promise<Inspection> {
  const problems: string[] = []
  let usable = 0
  for (const record of manifest.segments) {
    const size = await store.size(record.file)
    if (size === null) {
      problems.push(`Частини ${record.index + 1} немає у сховищі.`)
      break
    }
    if (size !== record.bytes) {
      problems.push(`Частина ${record.index + 1} має інший розмір, ніж записано в журналі.`)
      break
    }
    if (depth === 'full') {
      const reason = await verifyFile(store, record.file, record)
      if (reason) {
        problems.push(`Частина ${record.index + 1}: ${reason}`)
        break
      }
    }
    usable++
  }
  let audioUsable = manifest.audioState !== 'done'
  if (manifest.audioState === 'done' && manifest.audio) {
    const size = await store.size(manifest.audio.file)
    if (size !== manifest.audio.bytes) {
      problems.push(size === null ? 'Звуку немає у сховищі.' : 'Звук має інший розмір, ніж записано в журналі.')
    } else if (depth === 'full') {
      const reason = await verifyFile(store, manifest.audio.file, manifest.audio)
      if (reason) problems.push(`Звук: ${reason}`)
      else audioUsable = true
    } else {
      audioUsable = true
    }
  }
  return { usable, audioUsable, problems }
}

async function verifyFile(
  store: JournalStore,
  name: string,
  record: { packets: number; bytes: number; crc: number },
): Promise<string | null> {
  const bytes = await store.read(name)
  if (!bytes) return 'файлу немає у сховищі.'
  try {
    const { stats } = readPacketFile(bytes)
    return matches(stats, record) ? null : 'вміст не збігається з журналом.'
  } catch (error) {
    if (error instanceof JournalCorrupt) return error.message
    throw error
  }
}

// The manifest cut down to what the files can back up. When the sound is gone
// it goes back to pending: it is encoded again.
export function repaired(manifest: Manifest, inspection: Inspection): Manifest {
  let result = keepSegments(manifest, inspection.usable)
  if (manifest.audioState === 'done' && !inspection.audioUsable) {
    result = { ...result, audioState: 'pending', audio: null, audioConfig: null, notes: [] }
  }
  return result
}

// Removes the files the manifest does not list: a segment that was being
// written when the page died, or one that came after a damaged one.
export async function sweep(store: JournalStore, manifest: Manifest): Promise<string[]> {
  const keep = new Set<string>([MANIFEST_FILE])
  for (const record of manifest.segments) keep.add(record.file)
  if (manifest.audio && manifest.audioState === 'done') keep.add(AUDIO_FILE)
  const removed: string[] = []
  for (const name of await store.list()) {
    if (keep.has(name)) continue
    await store.remove(name)
    removed.push(name)
  }
  return removed
}

// The CRC-32 of a buffer, for callers that check a file they made themselves.
export const checksum = (bytes: Uint8Array): number => crc32(bytes)
