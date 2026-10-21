// src/resume/packets.ts
import type { EncodedPacket } from 'mediabunny'
import type { StoredPacket } from './packetFile.ts'

// A packet an encoder made, as the journal keeps it.
export function toStored(packet: EncodedPacket, kind: 'video' | 'audio'): StoredPacket {
  return {
    kind,
    key: packet.type === 'key',
    timestamp: packet.timestamp,
    duration: packet.duration,
    data: packet.data,
  }
}
