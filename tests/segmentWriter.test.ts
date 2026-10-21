// tests/segmentWriter.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readPacketFile } from '../src/resume/packetFile.ts'
import type { StoredPacket } from '../src/resume/packetFile.ts'
import { SegmentWriter } from '../src/resume/segmentWriter.ts'
import { memoryStore } from '../src/resume/store.ts'
import type { JournalFile } from '../src/resume/store.ts'

const packet = (i: number, size = 100): StoredPacket => ({
  kind: 'video',
  key: i === 0,
  timestamp: i / 30,
  duration: 1 / 30,
  data: new Uint8Array(size).fill(i % 251),
})

describe('SegmentWriter', () => {
  it('writes a file that reads back with the stats it reports', async () => {
    const store = memoryStore()
    const writer = new SegmentWriter(await store.create('a.tzs'), 1000)
    for (let i = 0; i < 50; i++) writer.add(packet(i))
    const stats = await writer.finish()
    const bytes = (await store.read('a.tzs')) as Uint8Array
    const read = readPacketFile(bytes)
    assert.equal(read.packets.length, 50)
    assert.deepEqual(read.stats, stats)
    assert.equal(bytes.length, stats.bytes)
    assert.equal(read.packets[7].timestamp, 7 / 30)
    assert.equal(read.packets[0].key, true)
    assert.equal(read.packets[7].key, false)
  })

  it('writes an empty file that is still whole', async () => {
    const store = memoryStore()
    const writer = new SegmentWriter(await store.create('a.tzs'))
    const stats = await writer.finish()
    assert.equal(stats.packets, 0)
    assert.equal(readPacketFile((await store.read('a.tzs')) as Uint8Array).packets.length, 0)
  })

  it('gathers small packets into larger writes', async () => {
    const writes: number[] = []
    const file: JournalFile = {
      write: async (chunk) => {
        writes.push(chunk.length)
      },
      commit: async () => {},
      abort: async () => {},
    }
    const writer = new SegmentWriter(file, 4096)
    for (let i = 0; i < 100; i++) writer.add(packet(i, 100))
    await writer.finish()
    assert.ok(writes.length < 20, `${writes.length} writes`)
    assert.ok(writes.slice(0, -1).every((size) => size >= 4096))
  })

  it('leaves nothing under the name when aborted', async () => {
    const store = memoryStore()
    const writer = new SegmentWriter(await store.create('a.tzs'), 100)
    for (let i = 0; i < 10; i++) writer.add(packet(i))
    await writer.abort()
    assert.equal(await store.read('a.tzs'), null)
  })

  it('leaves nothing under the name when the page dies', async () => {
    const store = memoryStore()
    const writer = new SegmentWriter(await store.create('a.tzs'), 100)
    for (let i = 0; i < 10; i++) writer.add(packet(i))
    store.crash()
    await assert.rejects(writer.finish())
    assert.equal(await store.read('a.tzs'), null)
  })

  it('raises a failure of the storage on the next call', async () => {
    const file: JournalFile = {
      write: async () => {
        throw new Error('диск повний')
      },
      commit: async () => {},
      abort: async () => {},
    }
    const writer = new SegmentWriter(file, 50)
    writer.add(packet(0))
    writer.add(packet(1))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await assert.rejects(writer.ready(), /диск повний/)
    assert.throws(() => writer.add(packet(2)), /диск повний/)
    await writer.abort()
  })

  it('holds the producer back while the storage is far behind', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let written = 0
    const file: JournalFile = {
      write: async (chunk) => {
        await gate
        written += chunk.length
      },
      commit: async () => {},
      abort: async () => {},
    }
    const writer = new SegmentWriter(file, 100)
    for (let i = 0; i < 30; i++) writer.add(packet(i, 100))
    let passed = false
    const ready = writer.ready().then(() => {
      passed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(passed, false)
    release()
    await ready
    assert.equal(passed, true)
    await writer.finish()
    assert.ok(written > 0)
  })

  it('refuses packets after the file is finished', async () => {
    const store = memoryStore()
    const writer = new SegmentWriter(await store.create('a.tzs'))
    await writer.finish()
    assert.throws(() => writer.add(packet(0)))
  })
})
