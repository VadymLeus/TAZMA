// tests/session.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readManifest, writeManifest, writeWhole } from '../src/resume/journal.ts'
import { AUDIO_FILE, newManifest, segmentFile, withAudio, withSegment } from '../src/resume/manifest.ts'
import type { Manifest, ManifestInit } from '../src/resume/manifest.ts'
import { PacketFileWriter } from '../src/resume/packetFile.ts'
import { JournalMismatch, openJournal } from '../src/resume/session.ts'
import { memoryStore } from '../src/resume/store.ts'
import type { JournalStore } from '../src/resume/store.ts'

const init = (over: Partial<ManifestInit> = {}): ManifestInit => ({
  job: 'job-1',
  fingerprint: 'abc',
  total: 90,
  segmentSeconds: 30,
  recipe: null,
  hasAudio: true,
  now: 1000,
  ...over,
})

// A packet file with one video packet, as the export writes it.
function packetFile(count = 1): { chunks: Uint8Array[]; packets: number; bytes: number; crc: number } {
  const writer = new PacketFileWriter()
  const chunks = [writer.begin()]
  for (let i = 0; i < count; i++) {
    chunks.push(...writer.add({ kind: 'video', key: i === 0, timestamp: i / 10, duration: 0.1, data: new Uint8Array([i, 2, 3]) }))
  }
  chunks.push(writer.end())
  const { packets, bytes, crc } = writer.stats
  return { chunks, packets, bytes, crc }
}

async function journalWithSegments(store: JournalStore, count: number, audio = true): Promise<Manifest> {
  let manifest = newManifest(init())
  for (let i = 0; i < count; i++) {
    const file = packetFile()
    await writeWhole(store, segmentFile(i), file.chunks)
    manifest = withSegment(
      manifest,
      { index: i, file: segmentFile(i), from: i * 30, to: (i + 1) * 30, packets: file.packets, bytes: file.bytes, crc: file.crc },
      2000 + i,
    )
  }
  if (audio) {
    const file = packetFile(3)
    await writeWhole(store, AUDIO_FILE, file.chunks)
    manifest = withAudio(manifest, { file: AUDIO_FILE, packets: file.packets, bytes: file.bytes, crc: file.crc }, { codec: 'opus' }, 2100)
  }
  await writeManifest(store, manifest)
  return manifest
}

describe('openJournal', () => {
  it('starts a new journal in an empty store', async () => {
    const store = memoryStore()
    const opened = await openJournal(store, init(), false)
    assert.equal(opened.continued, false)
    assert.equal(opened.manifest.segments.length, 0)
    assert.equal(opened.manifest.audioState, 'pending')
    assert.deepEqual(await readManifest(store), opened.manifest)
  })

  it('clears what a store held when a new export starts in it', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 2)
    const opened = await openJournal(store, init(), false)
    assert.equal(opened.continued, false)
    assert.deepEqual((await store.list()).sort(), ['manifest.json'])
  })

  it('goes on with the journal of the same export', async () => {
    const store = memoryStore()
    const before = await journalWithSegments(store, 2)
    const opened = await openJournal(store, init(), true)
    assert.equal(opened.continued, true)
    assert.deepEqual(opened.manifest, before)
    assert.deepEqual(opened.notes, [])
  })

  it('starts anew when there is nothing to go on from', async () => {
    const store = memoryStore()
    const opened = await openJournal(store, init(), true)
    assert.equal(opened.continued, false)
    assert.equal(opened.manifest.segments.length, 0)
  })

  it('refuses a journal made for another export', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 1)
    await assert.rejects(openJournal(store, init({ fingerprint: 'other' }), true), JournalMismatch)
    assert.ok((await store.list()).includes(segmentFile(0)))
  })

  it('starts anew over a manifest that cannot be read', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 1)
    await writeWhole(store, 'manifest.json', [new TextEncoder().encode('{"version":')])
    const opened = await openJournal(store, init(), true)
    assert.equal(opened.continued, false)
    assert.equal(opened.notes.length, 1)
    assert.deepEqual((await store.list()).sort(), ['manifest.json'])
  })

  it('drops a part that is gone, and the parts after it', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 3)
    await store.remove(segmentFile(1))
    const opened = await openJournal(store, init(), true)
    assert.equal(opened.continued, true)
    assert.equal(opened.manifest.segments.length, 1)
    assert.ok(opened.notes.length > 0)
    assert.equal((await readManifest(store))?.segments.length, 1)
    assert.ok(!(await store.list()).includes(segmentFile(2)))
  })

  it('encodes the sound again when its file is gone', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 1)
    await store.remove(AUDIO_FILE)
    const opened = await openJournal(store, init(), true)
    assert.equal(opened.manifest.audioState, 'pending')
    assert.equal(opened.manifest.audio, null)
    assert.equal(opened.manifest.segments.length, 1)
  })

  it('removes the file a page that died was writing', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 1)
    await writeWhole(store, segmentFile(1), packetFile().chunks)
    const opened = await openJournal(store, init(), true)
    assert.equal(opened.manifest.segments.length, 1)
    assert.ok(!(await store.list()).includes(segmentFile(1)))
  })
})

describe('openJournal with an end to end check', () => {
  it('finds a part whose bytes changed while its size did not, and drops it with the parts after it', async () => {
    const store = memoryStore()
    await journalWithSegments(store, 3)
    const bytes = (await store.read(segmentFile(1))) as Uint8Array
    const changed = bytes.slice()
    changed[20] ^= 0xff
    await writeWhole(store, segmentFile(1), [changed])
    const bySize = await openJournal(store, init(), true, 'size')
    assert.equal(bySize.manifest.segments.length, 3)
    const full = await openJournal(store, init(), true, 'full')
    assert.equal(full.manifest.segments.length, 1)
    assert.ok(full.notes.length > 0)
    assert.ok(!(await store.list()).includes(segmentFile(2)))
  })
})
