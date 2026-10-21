// src/resume/packetFile.ts
import { crc32 } from './crc32.ts'
import { JournalCorrupt } from './corrupt.ts'

// One encoded packet as the journal keeps it.
export interface StoredPacket {
  kind: 'video' | 'audio'
  key: boolean
  timestamp: number
  duration: number
  data: Uint8Array
}

export interface PacketFileStats {
  packets: number
  bytes: number
  crc: number
}

// Layout: an 8-byte header (TZSG, version, three zero bytes), then for each
// packet a 24-byte record head (kind, flags, two zero bytes, timestamp and
// duration as float64, data length) and the data, then a 24-byte end record
// that holds the packet count and the CRC-32 of everything before it. A file
// that was cut short, or changed, fails on the end record.
const MAGIC = [0x54, 0x5a, 0x53, 0x47]
const VERSION = 1
const HEADER = 8
const RECORD = 24
const END = 0
const VIDEO = 1
const AUDIO = 2
const KEY = 1

export class PacketFileWriter {
  private crc = 0
  private packets = 0
  private bytes = 0
  private ended = false

  // The first bytes of the file.
  begin(): Uint8Array {
    const head = new Uint8Array(HEADER)
    head.set(MAGIC, 0)
    head[4] = VERSION
    return this.take(head)
  }

  // The chunks of one packet, in the order they are to be written.
  add(packet: StoredPacket): Uint8Array[] {
    if (this.ended) throw new Error('Файл журналу вже закрито.')
    const head = new Uint8Array(RECORD)
    const view = new DataView(head.buffer)
    head[0] = packet.kind === 'video' ? VIDEO : AUDIO
    head[1] = packet.key ? KEY : 0
    view.setFloat64(4, packet.timestamp, true)
    view.setFloat64(12, packet.duration, true)
    view.setUint32(20, packet.data.length, true)
    this.packets++
    return [this.take(head), this.take(packet.data)]
  }

  // The last bytes of the file; nothing may be added after them.
  end(): Uint8Array {
    this.ended = true
    const tail = new Uint8Array(RECORD)
    const view = new DataView(tail.buffer)
    tail[0] = END
    view.setUint32(4, this.packets, true)
    view.setUint32(8, this.crc, true)
    this.bytes += tail.length
    return tail
  }

  get stats(): PacketFileStats {
    return { packets: this.packets, bytes: this.bytes, crc: this.crc }
  }

  private take(chunk: Uint8Array): Uint8Array {
    this.crc = crc32(chunk, this.crc)
    this.bytes += chunk.length
    return chunk
  }
}

// Reads a whole file, checking it end to end. The packets' data points into
// `bytes`; it is not copied.
export function readPacketFile(bytes: Uint8Array): { packets: StoredPacket[]; stats: PacketFileStats } {
  if (bytes.length < HEADER + RECORD) throw new JournalCorrupt('Файл журналу обірваний.')
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new JournalCorrupt('Це не файл журналу.')
  }
  if (bytes[4] !== VERSION) throw new JournalCorrupt(`Невідома версія файлу журналу: ${bytes[4]}.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const packets: StoredPacket[] = []
  let at = HEADER
  for (;;) {
    if (at + RECORD > bytes.length) throw new JournalCorrupt('Файл журналу обірваний.')
    const kind = bytes[at] as number
    if (kind === END) {
      if (at + RECORD !== bytes.length) throw new JournalCorrupt('Після кінця файлу журналу є зайві дані.')
      const count = view.getUint32(at + 4, true)
      const crc = view.getUint32(at + 8, true)
      if (count !== packets.length) throw new JournalCorrupt('Число пакетів у файлі журналу не збігається.')
      if (crc32(bytes.subarray(0, at)) !== crc) throw new JournalCorrupt('Контрольна сума файлу журналу не збігається.')
      return { packets, stats: { packets: count, bytes: bytes.length, crc } }
    }
    if (kind !== VIDEO && kind !== AUDIO) throw new JournalCorrupt('У файлі журналу невідомий запис.')
    const length = view.getUint32(at + 20, true)
    const start = at + RECORD
    if (start + length + RECORD > bytes.length) throw new JournalCorrupt('Файл журналу обірваний.')
    packets.push({
      kind: kind === VIDEO ? 'video' : 'audio',
      key: ((bytes[at + 1] as number) & KEY) !== 0,
      timestamp: view.getFloat64(at + 4, true),
      duration: view.getFloat64(at + 12, true),
      data: bytes.subarray(start, start + length),
    })
    at = start + length
  }
}
