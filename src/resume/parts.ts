// src/resume/parts.ts
import type { EncodedPacket } from 'mediabunny'
import { FALLBACK_FRAME, MIN_FRAME } from '../export/frameTiming.ts'
import { emptyStages, timedItems } from '../export/stageTimes.ts'
import type { StageTimes } from '../export/stageTimes.ts'
import { ExportAborted } from '../export/types.ts'
import type { FrameItem, PacketItem, VideoItem } from '../export/videoItems.ts'
import { configToStored } from './configs.ts'
import type { StoredConfig } from './configs.ts'
import { Cutter } from './cuts.ts'
import { writeManifest } from './journal.ts'
import { resumeTime, segmentFile, withSegment, withVideoConfig } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { toStored } from './packets.ts'
import { SegmentWriter } from './segmentWriter.ts'
import type { JournalStore } from './store.ts'

const SAME = 1e-9

// One session of an encoder, as the cutting of the video sees it.
export interface Encoding {
  // Paints the frame and hands it to the encoder.
  add: (item: FrameItem, duration: number) => Promise<void>
  // Closes the session; resolves when its last packet was given out.
  end: () => Promise<void>
  cancel: () => Promise<void>
}

export type Emit = (packet: EncodedPacket, meta: EncodedVideoChunkMetadata | undefined) => void

// Whatever starts encoder sessions. Their packets go to `emit`, in order. The
// engine may add the time of its painting and encoding to `stages`.
export interface Engine {
  open: (emit: Emit, stages: StageTimes) => Promise<Encoding>
}

export interface PartsArgs {
  store: JournalStore
  manifest: Manifest
  items: AsyncIterable<VideoItem>
  engine: Engine
  // The parameters of the output stream when they are known before the first
  // packet is made; otherwise the first packet of the first session tells.
  config: StoredConfig | null
  // Sees every packet a session gives out and returns it as it goes into the
  // journal; throws when it does not fit the stream. `known` is what the pass
  // knows of the stream so far.
  accept: (
    packet: EncodedPacket,
    meta: EncodedVideoChunkMetadata | undefined,
    first: boolean,
    known: StoredConfig | null,
  ) => EncodedPacket
  signal?: AbortSignal
  onProgress?: (progress: { time: number; frames: number }) => void
}

export interface PartsResult {
  manifest: Manifest
  // Frames encoded by this run and their seconds.
  frames: number
  seconds: number
  // Packets this run took over from a source file as they were, and their seconds.
  copiedPackets: number
  copiedSeconds: number
  // Encoder sessions this run started.
  sessions: number
  // Parts finished by this run; the time it took to write and commit them,
  // and the time to close them altogether, in milliseconds.
  commits: number
  commitMs: number
  checkpointMs: number
  // The time to open the parts that followed a closed one: their files and
  // encoder sessions. Together with the closing it is what a checkpoint costs
  // before the frames flow again.
  openMs: number
  // Where the time of the loop went.
  stages: StageTimes
}

interface Part {
  writer: SegmentWriter
  // Opened right after the part before it was closed.
  afterCut: boolean
  encoding: Encoding | null
  copiedPackets: number
  copiedSeconds: number
}

// Writes the video into the parts of the journal. The items are cut by the
// time they are on: a part is a file of its own, closed when the cut falls,
// listed in the manifest once it is on disk. A part holds the packets of one
// stretch of the timeline, made by encoder sessions or copied, in the order of
// the output. Encoded frames always begin a session, and a session is ended
// before a copied packet is written, so a part is never written out of order.
// The cuts fall only where a part can begin: before a frame, which opens a
// new session, or before a key packet.
export async function runParts(args: PartsArgs): Promise<PartsResult> {
  const { store, engine, accept, signal, onProgress } = args
  let manifest = args.manifest
  let known = args.config ?? manifest.videoConfig
  const cutter = new Cutter(manifest.segmentSeconds, manifest.total, resumeTime(manifest))
  const result = {
    frames: 0,
    seconds: 0,
    copiedPackets: 0,
    copiedSeconds: 0,
    sessions: 0,
    commits: 0,
    commitMs: 0,
    checkpointMs: 0,
    openMs: 0,
    stages: emptyStages(),
  }
  const passBegan = performance.now()
  const framesBefore = manifest.segments.reduce((sum, record) => sum + record.packets, 0)
  const finish = (): PartsResult => ({ manifest, ...result })
  if (cutter.covered >= manifest.total - SAME) return finish()

  let part: Part | null = null
  // A problem met inside an encoder callback, raised by the main loop.
  let failure: unknown = null
  const check = () => {
    if (failure) throw failure
  }
  const done = () => framesBefore + result.frames + result.copiedPackets

  const emitFor = (target: Part): Emit => {
    let first = true
    return (packet, meta) => {
      try {
        const opening = first
        first = false
        const moved = accept(packet, meta, opening, known)
        if (opening && !known && meta?.decoderConfig) known = configToStored(meta.decoderConfig)
        target.writer.add(toStored(moved, 'video'))
      } catch (error) {
        failure ??= error
      }
    }
  }

  async function begin(time: number, afterCut: boolean): Promise<Part> {
    const began = performance.now()
    cutter.start(time)
    const writer = new SegmentWriter(await store.create(segmentFile(manifest.segments.length)))
    result.stages.createMs += performance.now() - began
    part = { writer, afterCut, encoding: null, copiedPackets: 0, copiedSeconds: 0 }
    if (afterCut) result.openMs += performance.now() - began
    return part
  }

  // Ends the encoder session of the part, if there is one: when it returns,
  // every packet the session made has been written to the part.
  async function endSession(target: Part): Promise<void> {
    const encoding = target.encoding
    if (!encoding) return
    target.encoding = null
    await encoding.end()
    check()
  }

  // Ends the part and commits it: the file first, then the manifest that
  // lists it.
  async function close(last: boolean): Promise<void> {
    const target = part as Part
    const began = performance.now()
    await endSession(target)
    const span = cutter.close(last)
    const committing = performance.now()
    const stats = await target.writer.finish()
    let next = manifest
    if (!next.videoConfig && known) next = withVideoConfig(next, known, Date.now())
    next = withSegment(
      next,
      {
        index: next.segments.length,
        file: segmentFile(next.segments.length),
        from: span.from,
        to: span.to,
        packets: stats.packets,
        bytes: stats.bytes,
        crc: stats.crc,
        ...(target.copiedPackets > 0
          ? { copied: { packets: target.copiedPackets, seconds: target.copiedSeconds } }
          : {}),
      },
      Date.now(),
    )
    await writeManifest(store, next)
    manifest = next
    part = null
    const ended = performance.now()
    result.commits++
    result.commitMs += ended - committing
    result.checkpointMs += ended - began
  }

  async function discard(): Promise<void> {
    const target = part
    part = null
    if (!target) return
    const encoding = target.encoding
    target.encoding = null
    await encoding?.cancel().catch(() => {})
    await target.writer.abort()
  }

  // Where the item falls: skipped, or the part it goes into, opened or
  // closed and reopened as the cut asks.
  async function place(time: number): Promise<Part | null> {
    let action = cutter.classify(time)
    if (action === 'skip') return null
    let afterCut = false
    if (action === 'cut') {
      await close(false)
      action = 'start'
      afterCut = true
    }
    return action === 'start' ? begin(time, afterCut) : (part as Part)
  }

  async function addFrame(item: FrameItem): Promise<void> {
    const { segment, sample, time } = item
    const natural = sample.duration > 0 ? sample.duration : FALLBACK_FRAME
    const duration = Math.min(natural, segment.offset + segment.length - time)
    if (duration < MIN_FRAME) return
    const target = await place(time)
    if (!target) return
    await target.writer.ready()
    if (!target.encoding) {
      const opening = performance.now()
      target.encoding = await engine.open(emitFor(target), result.stages)
      result.stages.startRunMs += performance.now() - opening
      result.sessions++
      if (target.afterCut) result.openMs += performance.now() - opening
    }
    await target.encoding.add(item, duration)
    result.stages.firstFrameMs ??= performance.now() - passBegan
    result.frames++
    result.seconds += duration
    onProgress?.({ time: time + duration, frames: done() })
  }

  async function addPacket(item: PacketItem): Promise<void> {
    const { packet, time } = item
    // Only a key packet can begin a part. The rest of a GOP whose key packet
    // lay in a part the journal already holds has no part to go to.
    const target = packet.type === 'key' ? await place(time) : part
    if (!target) return
    await endSession(target)
    await target.writer.ready()
    target.writer.add(toStored(packet, 'video'))
    target.copiedPackets++
    target.copiedSeconds += packet.duration
    result.copiedPackets++
    result.copiedSeconds += packet.duration
    onProgress?.({ time: time + packet.duration, frames: done() })
  }

  try {
    for await (const item of timedItems(args.items, result.stages)) {
      try {
        if (signal?.aborted) throw new ExportAborted()
        check()
        if (item.kind === 'frame') await addFrame(item)
        else await addPacket(item)
      } finally {
        if (item.kind === 'frame') item.sample.close()
      }
    }
    if (part) await close(true)
    check()
    return finish()
  } catch (error) {
    await discard()
    throw error
  }
}
