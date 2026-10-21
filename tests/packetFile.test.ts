// tests/packetFile.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JournalCorrupt } from '../src/resume/corrupt.ts'
import { PacketFileWriter, readPacketFile } from '../src/resume/packetFile.ts'
import type { StoredPacket } from '../src/resume/packetFile.ts'

const packet = (kind: 'video' | 'audio', key: boolean, timestamp: number, size: number, fill = 7): StoredPacket => ({
  kind,
  key,
  timestamp,
  duration: 1 / 30,
  data: new Uint8Array(size).fill(fill),
})

function build(packets: StoredPacket[]) {
  const writer = new PacketFileWriter()
  const chunks: Uint8Array[] = [writer.begin()]
  for (const item of packets) chunks.push(...writer.add(item))
  chunks.push(writer.end())
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return { bytes, stats: writer.stats }
}

describe('packet file', () => {
  it('reads back what was written, to the bit', () => {
    const packets = [
      packet('video', true, 0, 1000, 1),
      packet('video', false, 1 / 30, 120, 2),
      packet('audio', true, 0.0213333333, 300, 3),
      packet('video', false, 0.1 + 0.2, 0, 4),
    ]
    const { bytes, stats } = build(packets)
    const back = readPacketFile(bytes)
    assert.equal(back.packets.length, 4)
    packets.forEach((item, index) => {
      const got = back.packets[index] as StoredPacket
      assert.equal(got.kind, item.kind)
      assert.equal(got.key, item.key)
      assert.equal(got.timestamp, item.timestamp)
      assert.equal(got.duration, item.duration)
      assert.deepEqual([...got.data], [...item.data])
    })
    assert.deepEqual(back.stats, stats)
    assert.equal(stats.packets, 4)
    assert.equal(stats.bytes, bytes.length)
  })

  it('holds an empty file of no packets', () => {
    const { bytes, stats } = build([])
    assert.equal(readPacketFile(bytes).packets.length, 0)
    assert.equal(stats.packets, 0)
  })

  it('refuses a file that was cut short, wherever it was cut', () => {
    const { bytes } = build([packet('video', true, 0, 50), packet('video', false, 0.04, 50)])
    for (const cut of [0, 5, 8, 20, 40, 60, bytes.length - 25, bytes.length - 1]) {
      assert.throws(() => readPacketFile(bytes.slice(0, cut)), JournalCorrupt, `cut at ${cut}`)
    }
  })

  it('refuses a file in which a byte was changed', () => {
    const { bytes } = build([packet('video', true, 0, 200), packet('audio', true, 0, 200)])
    for (const at of [9, 40, 100, 250, 300]) {
      const copy = bytes.slice()
      copy[at] = (copy[at] as number) ^ 0x10
      assert.throws(() => readPacketFile(copy), JournalCorrupt, `byte ${at}`)
    }
  })

  it('refuses a file that is not a journal file, or of another version', () => {
    const { bytes } = build([packet('video', true, 0, 10)])
    const other = bytes.slice()
    other[0] = 0
    assert.throws(() => readPacketFile(other), /не файл журналу/)
    const version = bytes.slice()
    version[4] = 9
    assert.throws(() => readPacketFile(version), /версія/)
  })

  it('refuses data after the end record', () => {
    const { bytes } = build([packet('video', true, 0, 10)])
    const longer = new Uint8Array(bytes.length + 24)
    longer.set(bytes, 0)
    assert.throws(() => readPacketFile(longer), JournalCorrupt)
  })

  it('does not take packets after it was closed', () => {
    const writer = new PacketFileWriter()
    writer.begin()
    writer.end()
    assert.throws(() => writer.add(packet('video', true, 0, 1)))
  })

  it('does not copy the data when reading', () => {
    const { bytes } = build([packet('video', true, 0, 64)])
    const back = readPacketFile(bytes)
    const data = (back.packets[0] as StoredPacket).data
    assert.equal(data.buffer, bytes.buffer)
  })
})
