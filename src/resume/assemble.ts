// src/resume/assemble.ts
import { EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Output } from 'mediabunny'
import { createFormat } from '../export/codecs.ts'
import { mergeByTime } from '../export/merge.ts'
import type { ResultSink } from '../export/sink.ts'
import { ExportAborted } from '../export/types.ts'
import type { VideoSettings } from '../export/types.ts'
import { configFromStored } from './configs.ts'
import { JournalCorrupt } from './corrupt.ts'
import { readPacketFile } from './packetFile.ts'
import type { StoredPacket } from './packetFile.ts'
import type { Manifest } from './manifest.ts'
import type { JournalStore } from './store.ts'

export interface AssembleArgs {
  store: JournalStore
  manifest: Manifest
  settings: VideoSettings
  sink: ResultSink
  signal?: AbortSignal
  onProgress?: (progress: { time: number; frames: number }) => void
}

type Piece = { kind: 'video' | 'audio'; time: number; stored: StoredPacket }

const toPacket = (stored: StoredPacket): EncodedPacket =>
  new EncodedPacket(stored.data, stored.key ? 'key' : 'delta', stored.timestamp, stored.duration)

// The packets of a file of the journal, checked end to end against the record
// the manifest holds for it.
async function* packetsOf(
  store: JournalStore,
  record: { file: string; packets: number; bytes: number; crc: number },
  kind: 'video' | 'audio',
): AsyncGenerator<Piece> {
  const bytes = await store.read(record.file)
  if (!bytes) throw new JournalCorrupt(`Файлу «${record.file}» немає у сховищі журналу.`)
  const { packets, stats } = readPacketFile(bytes)
  if (stats.packets !== record.packets || stats.bytes !== record.bytes || stats.crc !== record.crc) {
    throw new JournalCorrupt(`Файл «${record.file}» не збігається з журналом.`)
  }
  for (const stored of packets) yield { kind, time: stored.timestamp, stored }
}

async function* videoPieces(store: JournalStore, manifest: Manifest): AsyncGenerator<Piece> {
  for (const record of manifest.segments) yield* packetsOf(store, record, 'video')
}

async function* audioPieces(store: JournalStore, manifest: Manifest): AsyncGenerator<Piece> {
  if (manifest.audioState === 'done' && manifest.audio) yield* packetsOf(store, manifest.audio, 'audio')
}

// Builds the file from the journal alone: the packets of every part and of
// the sound are written to the container in the order of their time. Nothing
// is decoded or encoded here. Returns the type of the file and the number of
// video packets.
export async function assemble(args: AssembleArgs): Promise<{ mimeType: string; frames: number }> {
  const { store, manifest, settings, sink, signal, onProgress } = args
  if (!manifest.complete) throw new Error('Журнал ще не завершено.')
  if (!manifest.videoConfig) throw new JournalCorrupt('У журналі немає параметрів відео.')
  const videoConfig = configFromStored<VideoDecoderConfig>(manifest.videoConfig)
  const audioConfig =
    manifest.audioState === 'done' && manifest.audioConfig
      ? configFromStored<AudioDecoderConfig>(manifest.audioConfig)
      : null

  const output = new Output({ format: createFormat(settings.container, !sink.onDisk), target: sink.target })
  const videoSource = new EncodedVideoPacketSource(settings.videoCodec)
  output.addVideoTrack(videoSource)
  const audioSource = audioConfig ? new EncodedAudioPacketSource(settings.audioCodec) : null
  if (audioSource) output.addAudioTrack(audioSource)
  try {
    await output.start()
    let frames = 0
    let audioFirst = true
    let videoFirst = true
    for await (const piece of mergeByTime<Piece>([videoPieces(store, manifest), audioPieces(store, manifest)])) {
      if (signal?.aborted) throw new ExportAborted()
      const packet = toPacket(piece.stored)
      if (piece.kind === 'video') {
        await videoSource.add(packet, videoFirst ? { decoderConfig: videoConfig } : undefined)
        videoFirst = false
        frames++
        onProgress?.({ time: piece.time + piece.stored.duration, frames })
      } else if (audioSource) {
        await audioSource.add(packet, audioFirst ? { decoderConfig: audioConfig as AudioDecoderConfig } : undefined)
        audioFirst = false
      }
    }
    videoSource.close()
    audioSource?.close()
    await output.finalize()
    return { mimeType: await output.getMimeType(), frames }
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {})
    }
    throw error
  }
}
