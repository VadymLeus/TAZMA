// tests/jobs.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summarizeJob } from '../src/resume/jobs.ts'
import { writeManifest, writeWhole } from '../src/resume/journal.ts'
import { AUDIO_FILE, makeRecipe, newManifest, segmentFile, withAudio, withComplete, withSegment } from '../src/resume/manifest.ts'
import type { Manifest } from '../src/resume/manifest.ts'
import { PacketFileWriter } from '../src/resume/packetFile.ts'
import { memoryStore } from '../src/resume/store.ts'
import type { JournalStore } from '../src/resume/store.ts'
import { defaultSettings } from '../src/export/settings.ts'

function file(count: number) {
  const writer = new PacketFileWriter()
  const chunks = [writer.begin()]
  for (let i = 0; i < count; i++) {
    chunks.push(...writer.add({ kind: 'video', key: i === 0, timestamp: i, duration: 1, data: new Uint8Array([i, 1]) }))
  }
  chunks.push(writer.end())
  return { chunks, ...writer.stats }
}

const recipe = () =>
  makeRecipe(
    {
      clips: [{ id: 'c', sourceId: 's', start: 0, end: 90 }],
      texts: [],
      sources: [{ id: 's', file: { name: 'a.mp4', size: 5, lastModified: 6 } as unknown as File, url: '', info: {} as never }],
    },
    { ...defaultSettings, mode: 'full', resumable: true },
  )

async function build(store: JournalStore, segments: number, opts: { audio?: boolean; complete?: boolean; recipe?: boolean } = {}): Promise<Manifest> {
  let manifest = newManifest({ job: 'j', fingerprint: 'f', total: 90, segmentSeconds: 30, recipe: opts.recipe === false ? null : recipe(), hasAudio: true, now: 10 })
  for (let i = 0; i < segments; i++) {
    const part = file(2)
    await writeWhole(store, segmentFile(i), part.chunks)
    manifest = withSegment(manifest, { index: i, file: segmentFile(i), from: i * 30, to: (i + 1) * 30, packets: part.packets, bytes: part.bytes, crc: part.crc }, 20 + i)
  }
  if (opts.audio) {
    const part = file(3)
    await writeWhole(store, AUDIO_FILE, part.chunks)
    manifest = withAudio(manifest, { file: AUDIO_FILE, packets: part.packets, bytes: part.bytes, crc: part.crc }, { codec: 'opus' }, 30)
  }
  if (opts.complete) manifest = withComplete(manifest, 40)
  await writeManifest(store, manifest)
  return manifest
}

describe('summarizeJob', () => {
  it('says how far the export got and which files it needs', async () => {
    const store = memoryStore()
    const manifest = await build(store, 2, { audio: true })
    const summary = await summarizeJob('j', store)
    assert.equal(summary.job, 'j')
    assert.equal(summary.total, 90)
    assert.equal(summary.covered, 60)
    assert.equal(summary.segments, 2)
    assert.equal(summary.bytes, manifest.segments.reduce((sum, record) => sum + record.bytes, 0) + (manifest.audio?.bytes ?? 0))
    assert.equal(summary.audio, 'done')
    assert.equal(summary.complete, false)
    assert.equal(summary.usable, true)
    assert.equal(summary.active, false)
    assert.deepEqual(summary.problems, [])
    assert.deepEqual(summary.sources, [{ id: 's', name: 'a.mp4', size: 5, lastModified: 6 }])
    assert.equal(summary.updated, manifest.updated)
  })

  it('counts only the parts that are still in the storage', async () => {
    const store = memoryStore()
    await build(store, 3, { audio: true })
    await store.remove(segmentFile(1))
    const summary = await summarizeJob('j', store)
    assert.equal(summary.segments, 1)
    assert.equal(summary.covered, 30)
    assert.equal(summary.usable, true)
    assert.ok(summary.problems.length > 0)
  })

  it('shows that the sound will be done again when its file is gone', async () => {
    const store = memoryStore()
    await build(store, 1, { audio: true })
    await store.remove(AUDIO_FILE)
    assert.equal((await summarizeJob('j', store)).audio, 'pending')
  })

  it('knows a journal whose video is all there', async () => {
    const store = memoryStore()
    await build(store, 3, { audio: true, complete: true })
    const summary = await summarizeJob('j', store, true)
    assert.equal(summary.complete, true)
    assert.equal(summary.covered, 90)
    assert.equal(summary.active, true)
  })

  it('cannot go on without the description of the project', async () => {
    const store = memoryStore()
    await build(store, 1, { recipe: false })
    const summary = await summarizeJob('j', store)
    assert.equal(summary.usable, false)
    assert.ok(summary.problems.some((problem) => problem.includes('опису проєкту')))
  })

  it('reports a store with no manifest or a broken one', async () => {
    const empty = memoryStore()
    const none = await summarizeJob('j', empty)
    assert.equal(none.usable, false)
    assert.equal(none.problems.length, 1)
    const broken = memoryStore()
    await writeWhole(broken, 'manifest.json', [new TextEncoder().encode('{"version":')])
    const bad = await summarizeJob('j', broken)
    assert.equal(bad.usable, false)
    assert.equal(bad.problems.length, 1)
  })
})
