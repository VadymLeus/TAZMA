// src/resume/audioPass.ts
import { AudioSampleSource, NullTarget, Output, Quality } from 'mediabunny'
import { createFormat } from '../export/codecs.ts'
import type { Segment } from '../export/plan.ts'
import { audioItems } from '../export/shared.ts'
import type { OpenedProject } from '../export/shared.ts'
import { ExportAborted } from '../export/types.ts'
import type { VideoSettings } from '../export/types.ts'
import { configToStored } from './configs.ts'
import type { StoredConfig } from './configs.ts'
import { writeManifest } from './journal.ts'
import { AUDIO_FILE, withAudio } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { toStored } from './packets.ts'
import { SegmentWriter } from './segmentWriter.ts'
import type { JournalStore } from './store.ts'

export interface AudioPassArgs {
  store: JournalStore
  manifest: Manifest
  settings: VideoSettings
  segments: Segment[]
  opened: OpenedProject
  signal?: AbortSignal
  // Timeline seconds of sound encoded so far.
  onProgress?: (time: number) => void
}

// Encodes the whole sound of the timeline in one encoder session and keeps
// the packets in a file of the journal. The sound is not cut into parts: an
// audio encoder started in the middle of a stream begins with a few samples
// of priming that are not in the signal, so cut sound would not join without
// a click. It is cheap next to the video, so this pass is repeated whole if
// it was interrupted.
export async function encodeAudio(args: AudioPassArgs): Promise<Manifest> {
  const { store, manifest, settings, segments, opened, signal, onProgress } = args
  const writer = new SegmentWriter(await store.create(AUDIO_FILE))
  const output = new Output({ format: createFormat(settings.container, false), target: new NullTarget() })
  let config: StoredConfig | null = null
  let failure: unknown = null
  const source = new AudioSampleSource({
    codec: settings.audioCodec,
    quality: new Quality(settings.quality),
    onEncodedPacket: (packet, meta) => {
      if (!config && meta?.decoderConfig) config = configToStored(meta.decoderConfig)
      try {
        writer.add(toStored(packet, 'audio'))
      } catch (error) {
        failure ??= error
      }
    },
  })
  output.addAudioTrack(source)
  try {
    await output.start()
    for await (const item of audioItems(segments, opened)) {
      try {
        if (signal?.aborted) throw new ExportAborted()
        if (failure) throw failure
        await writer.ready()
        const end = item.time + item.sample.numberOfFrames / item.sample.sampleRate
        await source.add(item.sample)
        onProgress?.(end)
      } finally {
        item.sample.close()
      }
    }
    source.close()
    await output.finalize()
    if (failure) throw failure
    const stats = await writer.finish()
    if (stats.packets > 0 && !config) {
      throw new Error('Кодувальник звуку не повернув параметрів потоку.')
    }
    const next = withAudio(
      manifest,
      { file: AUDIO_FILE, packets: stats.packets, bytes: stats.bytes, crc: stats.crc },
      config,
      Date.now(),
      opened.notes,
    )
    await writeManifest(store, next)
    return next
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {})
    }
    await writer.abort()
    throw error
  }
}
