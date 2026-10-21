// src/resume/segmentWriter.ts
import { PacketFileWriter } from './packetFile.ts'
import type { PacketFileStats, StoredPacket } from './packetFile.ts'
import type { JournalFile } from './store.ts'

const FLUSH_BYTES = 1024 * 1024
// How many flushes may wait for the storage before the producer is held up.
const MAX_WAITING = 4

// Writes the packets of one file of the journal as they are encoded. Packets
// come from encoder callbacks, which cannot wait, so they are gathered and
// written in large pieces; `ready` holds the producer back if the storage
// falls behind.
export class SegmentWriter {
  private readonly format = new PacketFileWriter()
  private pending: Uint8Array[] = []
  private pendingBytes = 0
  private waiting = 0
  private queue: Promise<void> = Promise.resolve()
  private failure: unknown = null
  private closed = false
  private readonly file: JournalFile
  private readonly flushBytes: number

  constructor(file: JournalFile, flushBytes = FLUSH_BYTES) {
    this.file = file
    this.flushBytes = flushBytes
    this.queueChunk(this.format.begin())
  }

  add(packet: StoredPacket): void {
    this.check()
    for (const chunk of this.format.add(packet)) this.queueChunk(chunk)
  }

  // Resolves when the storage has caught up enough for more packets.
  async ready(): Promise<void> {
    while (this.waiting > MAX_WAITING) await this.queue
    this.check()
  }

  // Writes the end of the file and makes it visible. Returns what the
  // manifest is to record about it.
  async finish(): Promise<PacketFileStats> {
    this.check()
    this.queueChunk(this.format.end())
    this.flush()
    await this.queue
    this.check()
    await this.file.commit()
    this.closed = true
    return this.format.stats
  }

  // Drops the file; nothing of it is left under its name.
  async abort(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.pending = []
    await this.queue
    await this.file.abort().catch(() => {})
  }

  private queueChunk(chunk: Uint8Array): void {
    this.pending.push(chunk)
    this.pendingBytes += chunk.length
    if (this.pendingBytes >= this.flushBytes) this.flush()
  }

  private flush(): void {
    if (this.pendingBytes === 0) return
    const whole = new Uint8Array(this.pendingBytes)
    let at = 0
    for (const chunk of this.pending) {
      whole.set(chunk, at)
      at += chunk.length
    }
    this.pending = []
    this.pendingBytes = 0
    this.waiting++
    this.queue = this.queue
      .then(() => (this.failure ? undefined : this.file.write(whole)))
      .catch((error) => {
        this.failure ??= error
      })
      .finally(() => {
        this.waiting--
      })
  }

  private check(): void {
    if (this.failure) throw this.failure
    if (this.closed) throw new Error('Файл журналу вже закрито.')
  }
}
