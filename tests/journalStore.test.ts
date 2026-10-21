// tests/journalStore.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inspectJournal, readManifest, repaired, sweep, writeManifest, writeWhole } from '../src/resume/journal.ts'
import {
  AUDIO_FILE,
  MANIFEST_FILE,
  newManifest,
  resumeTime,
  segmentFile,
  withAudio,
  withSegment,
} from '../src/resume/manifest.ts'
import type { Manifest } from '../src/resume/manifest.ts'
import { PacketFileWriter } from '../src/resume/packetFile.ts'
import type { StoredPacket } from '../src/resume/packetFile.ts'
import { memoryStore } from '../src/resume/store.ts'
import type { JournalStore } from '../src/resume/store.ts'

function fileOf(packets: StoredPacket[]) {
  const writer = new PacketFileWriter()
  const chunks = [writer.begin()]
  for (const item of packets) chunks.push(...writer.add(item))
  chunks.push(writer.end())
  return { chunks, stats: writer.stats }
}

const some = (kind: 'video' | 'audio', from: number, count: number): StoredPacket[] =>
  Array.from({ length: count }, (_, i) => ({
    kind,
    key: i === 0,
    timestamp: from + i / 30,
    duration: 1 / 30,
    data: new Uint8Array(40 + i).fill(i + 1),
  }))

async function commitSegment(store: JournalStore, manifest: Manifest, from: number, to: number): Promise<Manifest> {
  const index = manifest.segments.length
  const { chunks, stats } = fileOf(some('video', from, 5))
  await writeWhole(store, segmentFile(index), chunks)
  const next = withSegment(manifest, { index, file: segmentFile(index), from, to, ...stats }, 10 + index)
  await writeManifest(store, next)
  return next
}

async function commitAudio(store: JournalStore, manifest: Manifest): Promise<Manifest> {
  const { chunks, stats } = fileOf(some('audio', 0, 8))
  await writeWhole(store, AUDIO_FILE, chunks)
  const next = withAudio(manifest, { file: AUDIO_FILE, ...stats }, { codec: 'opus' }, 20)
  await writeManifest(store, next)
  return next
}

const start = () =>
  newManifest({ job: 'j', fingerprint: 'f', total: 90, segmentSeconds: 30, recipe: null, hasAudio: true, now: 1 })

describe('memory store', () => {
  it('shows a file only after it is committed', async () => {
    const store = memoryStore()
    const file = await store.create('a.bin')
    await file.write(new Uint8Array([1, 2, 3]))
    assert.equal(await store.read('a.bin'), null)
    await file.commit()
    assert.deepEqual([...((await store.read('a.bin')) as Uint8Array)], [1, 2, 3])
    assert.equal(await store.size('a.bin'), 3)
  })

  it('replaces a file whole, and keeps the old one if the new one is not finished', async () => {
    const store = memoryStore()
    await writeWhole(store, 'a.bin', [new Uint8Array([1])])
    const file = await store.create('a.bin')
    await file.write(new Uint8Array([2, 2]))
    assert.deepEqual([...((await store.read('a.bin')) as Uint8Array)], [1])
    await file.abort()
    assert.deepEqual([...((await store.read('a.bin')) as Uint8Array)], [1])
  })

  it('loses what was being written when the page dies, and nothing else', async () => {
    const store = memoryStore()
    await writeWhole(store, 'done.bin', [new Uint8Array([1, 2])])
    const file = await store.create('half.bin')
    await file.write(new Uint8Array([9]))
    store.crash()
    await assert.rejects(file.commit())
    assert.equal(await store.read('half.bin'), null)
    assert.deepEqual(await store.list(), ['done.bin'])
  })
})

describe('journal', () => {
  it('writes and reads the manifest', async () => {
    const store = memoryStore()
    assert.equal(await readManifest(store), null)
    const manifest = await commitSegment(store, start(), 0, 30)
    assert.deepEqual(await readManifest(store), manifest)
  })

  it('finds a journal whole when every file is where the manifest says', async () => {
    const store = memoryStore()
    let manifest = start()
    manifest = await commitSegment(store, manifest, 0, 30)
    manifest = await commitSegment(store, manifest, 30, 60)
    manifest = await commitAudio(store, manifest)
    for (const depth of ['size', 'full'] as const) {
      const found = await inspectJournal(store, manifest, depth)
      assert.equal(found.usable, 2)
      assert.equal(found.audioUsable, true)
      assert.deepEqual(found.problems, [])
    }
  })

  it('goes on from the last segment that was committed when the page died in the next', async () => {
    const store = memoryStore()
    let manifest = start()
    manifest = await commitSegment(store, manifest, 0, 30)
    manifest = await commitSegment(store, manifest, 30, 60)
    // The third segment is being written.
    const file = await store.create(segmentFile(2))
    await file.write(new Uint8Array(500))
    store.crash()
    const loaded = (await readManifest(store)) as Manifest
    const found = await inspectJournal(store, loaded, 'full')
    assert.equal(found.usable, 2)
    assert.equal(resumeTime(repaired(loaded, found)), 60)
    assert.deepEqual(await sweep(store, loaded), [])
  })

  it('goes on from before a segment whose file is missing, cut, or changed', async () => {
    for (const damage of ['missing', 'cut', 'changed'] as const) {
      const store = memoryStore()
      let manifest = start()
      manifest = await commitSegment(store, manifest, 0, 30)
      manifest = await commitSegment(store, manifest, 30, 60)
      manifest = await commitSegment(store, manifest, 60, 90)
      const name = segmentFile(1)
      const bytes = (await store.read(name)) as Uint8Array
      if (damage === 'missing') await store.remove(name)
      if (damage === 'cut') await writeWhole(store, name, [bytes.slice(0, bytes.length - 3)])
      if (damage === 'changed') {
        const copy = bytes.slice()
        copy[30] = (copy[30] as number) ^ 1
        await writeWhole(store, name, [copy])
      }
      // A change that keeps the size is found by the full check only.
      const found = await inspectJournal(store, manifest, damage === 'changed' ? 'full' : 'size')
      assert.equal(found.usable, 1, damage)
      assert.equal(found.problems.length, 1, damage)
      const fixed = repaired(manifest, found)
      assert.equal(resumeTime(fixed), 30, damage)
      assert.equal(fixed.complete, false)
      // The segments after the damaged one are of no use and are removed.
      const removed = await sweep(store, fixed)
      assert.ok(removed.includes(segmentFile(2)), damage)
      assert.ok(!removed.includes(segmentFile(0)), damage)
    }
  })

  it('does not see a change of content that keeps the size, unless asked to look', async () => {
    const store = memoryStore()
    let manifest = await commitSegment(store, start(), 0, 30)
    const bytes = ((await store.read(segmentFile(0))) as Uint8Array).slice()
    bytes[20] = (bytes[20] as number) ^ 1
    await writeWhole(store, segmentFile(0), [bytes])
    assert.equal((await inspectJournal(store, manifest, 'size')).usable, 1)
    assert.equal((await inspectJournal(store, manifest, 'full')).usable, 0)
    manifest = repaired(manifest, await inspectJournal(store, manifest, 'full'))
    assert.equal(manifest.segments.length, 0)
  })

  it('has the sound encoded again when its file is gone', async () => {
    const store = memoryStore()
    let manifest = await commitSegment(store, start(), 0, 30)
    manifest = await commitAudio(store, manifest)
    await store.remove(AUDIO_FILE)
    const found = await inspectJournal(store, manifest)
    assert.equal(found.audioUsable, false)
    assert.equal(found.usable, 1)
    const fixed = repaired(manifest, found)
    assert.equal(fixed.audioState, 'pending')
    assert.equal(fixed.audio, null)
    assert.equal(fixed.segments.length, 1)
  })

  it('does not ask for sound the project does not have', async () => {
    const store = memoryStore()
    const manifest = await commitSegment(
      store,
      newManifest({ job: 'j', fingerprint: 'f', total: 90, segmentSeconds: 30, recipe: null, hasAudio: false, now: 1 }),
      0,
      30,
    )
    const found = await inspectJournal(store, manifest, 'full')
    assert.equal(found.audioUsable, true)
    assert.equal(repaired(manifest, found), manifest)
  })

  it('removes files that no manifest lists, and keeps the ones it does', async () => {
    const store = memoryStore()
    let manifest = await commitSegment(store, start(), 0, 30)
    manifest = await commitAudio(store, manifest)
    await writeWhole(store, segmentFile(7), [new Uint8Array(3)])
    await writeWhole(store, 'stray.tmp', [new Uint8Array(3)])
    const removed = await sweep(store, manifest)
    assert.deepEqual(removed.sort(), [segmentFile(7), 'stray.tmp'].sort())
    assert.deepEqual((await store.list()).sort(), [AUDIO_FILE, MANIFEST_FILE, segmentFile(0)].sort())
  })

  it('keeps the old manifest when writing the new one is cut off', async () => {
    const store = memoryStore()
    const manifest = await commitSegment(store, start(), 0, 30)
    const file = await store.create(MANIFEST_FILE)
    await file.write(new TextEncoder().encode('{"version":1,"jo'))
    store.crash()
    assert.deepEqual(await readManifest(store), manifest)
  })
})
