// src/export/selectiveSource.ts
import { EncodedPacketSink, VideoSampleSink } from 'mediabunny'
import type { EncodedPacket, InputVideoTrack } from 'mediabunny'
import type { FrameSize } from '../project/frame.ts'
import type { TextItem } from '../project/types.ts'
import { ParameterRegistry, startsWithIdr } from './avcSets.ts'
import { isClosedGop } from './gop.ts'
import type { Segment } from './plan.ts'
import { analyzeProject, toBytes } from './selectiveAnalysis.ts'
import { planSelective } from './selectivePlan.ts'
import type { Piece } from './selectivePlan.ts'
import type { OpenedProject } from './shared.ts'
import { emptyReadTimes, pulled } from './stageTimes.ts'
import type { ReadTimes } from './stageTimes.ts'
import type { VideoSettings } from './types.ts'
import type { FrameItem, VideoItem } from './videoItems.ts'

const EPS = 1e-6
const ENCODER = 'encoder'
// A frame this much before the place to go on from is still read, so that the
// first frame wanted is never the one before it.
const SEEK_MARGIN = 0.01

export interface SelectiveArgs {
  segments: Segment[]
  texts: TextItem[]
  opened: OpenedProject
  settings: VideoSettings
  size: FrameSize
  signal?: AbortSignal
}

// The video of a selective export before anything is written: what is copied
// and what is encoded again, and the parameters of the output stream.
export interface SelectiveSource {
  // What describes the output track: for H.264 the parameter sets of every
  // file the output takes packets from, each under a number of its own.
  videoConfig: VideoDecoderConfig
  // Counted as the items are read.
  counts: { fallbackGops: number; rewritten: number }
  // The time the stream has spent so far reading, finding key packets and
  // waiting for the decoder.
  timing: ReadTimes
  // The video in the order of the output: decoded frames of the stretches that
  // are encoded again and the packets of those that are copied. Items that
  // end before `from` (timeline seconds) are not read; the ones around it
  // may be, and the caller drops them by their time.
  items: (from?: number) => AsyncGenerator<VideoItem>
  // A packet an encoder session of the output made, moved onto the output's
  // parameter sets; null when that cannot be done.
  fromEncoder: (packet: EncodedPacket) => EncodedPacket | null
  // Why the first packet of an encoder session does not fit the output
  // stream, or null.
  sessionProblem: (meta: EncodedVideoChunkMetadata | undefined) => Error | null
}

export async function prepareSelective(args: SelectiveArgs): Promise<SelectiveSource> {
  const { segments, texts, opened, settings, size, signal } = args
  const analysis = await analyzeProject(segments, opened, settings, size, signal)
  let pieces = planSelective(segments, texts, analysis.analyses)

  // H.264 from several files shares one track: every set the output uses
  // is written into its description under a number of its own.
  let registry: ParameterRegistry | null = null
  if (settings.videoCodec === 'avc') {
    const encoderStream = { key: ENCODER, description: analysis.encoder.description }
    const used = new Set<string>()
    for (const piece of pieces) {
      if (piece.kind === 'copy') used.add(segments[piece.segment].clip.sourceId)
    }
    registry = ParameterRegistry.create([
      ...[...used].map((id) => ({ key: id, description: analysis.streams.get(id)?.description })),
      encoderStream,
    ])
    if (!registry) {
      for (const item of analysis.analyses) item.copyable = false
      pieces = planSelective(segments, texts, analysis.analyses)
      registry = ParameterRegistry.create([encoderStream])
    }
  }
  const videoConfig: VideoDecoderConfig = registry
    ? { ...analysis.encoder.config, codec: registry.codecString, description: registry.description }
    : analysis.encoder.config

  const counts = { fallbackGops: 0, rewritten: 0 }
  const timing: ReadTimes = { ...emptyReadTimes(), ...analysis.timing }
  let began: number | null = null

  // Moves a packet of the stream called key onto the numbers of the
  // output's parameter sets; null when that cannot be done.
  const moveToOutput = (packet: EncodedPacket, key: string): EncodedPacket | null => {
    if (!registry) return packet
    const data = registry.rewrite(key, packet.data)
    if (!data) return null
    return data === packet.data ? packet : packet.clone({ data })
  }

  const fromEncoder = (packet: EncodedPacket): EncodedPacket | null => {
    const moved = moveToOutput(packet, ENCODER)
    if (moved && moved !== packet) counts.rewritten++
    return moved
  }

  const sessionProblem = (meta: EncodedVideoChunkMetadata | undefined): Error | null => {
    // The output's description was fixed with the first packet, so a
    // session that comes back with other parameter sets cannot be used.
    const reported = toBytes(meta?.decoderConfig?.description)
    if (registry && reported && !registry.matches(ENCODER, reported)) {
      return new Error('Кодувальник повернув інші параметри H.264 у новому сеансі. Спробуйте повне перекодування.')
    }
    return null
  }

  // The place in the source of the timeline second `resume`.
  const sourceTime = (segment: Segment, resume: number): number =>
    segment.start + (resume - segment.offset)

  async function* recodeFrames(
    segment: Segment,
    track: InputVideoTrack,
    from: number,
    to: number,
    keepFirst: boolean,
    resume: number,
  ): AsyncGenerator<FrameItem> {
    const sink = new VideoSampleSink(track)
    const seek = resume > segment.offset ? Math.max(from, sourceTime(segment, resume) - SEEK_MARGIN) : from
    // The first frame of the export to come out of a decoder: when it was
    // asked for and how long it took. A stretch with no frame in it (a sliver
    // at the edge) does not count.
    const asked = performance.now()
    let lastWait = 0
    const waited = (ms: number) => {
      timing.decodeMs += ms
      lastWait = ms
    }
    for await (const sample of pulled(sink.samples(seek, to), waited)) {
      if (timing.decodeAskMs === null && began !== null) {
        timing.decodeAskMs = asked - began
        timing.firstSampleMs = lastWait
      }
      if (!keepFirst && sample.timestamp < from - EPS) {
        sample.close()
        continue
      }
      const time = segment.offset + Math.max(0, sample.timestamp - segment.start)
      yield { kind: 'frame', time, sample, segment }
    }
  }

  // One GOP is read whole before anything is sent: a GOP whose frames reach
  // outside its key frame window (open GOP) is decoded and encoded again.
  async function* copyPackets(
    segment: Segment,
    track: InputVideoTrack,
    piece: Extract<Piece, { kind: 'copy' }>,
    resume: number,
  ): AsyncGenerator<VideoItem> {
    const sink = new EncodedPacketSink(track)
    const seeking = performance.now()
    const start = await sink.getKeyPacket(piece.from + EPS)
    const end = piece.toEnd ? null : await sink.getKeyPacket(piece.to + EPS)
    timing.seekMs += performance.now() - seeking
    const aligned =
      start !== null &&
      Math.abs(start.timestamp - piece.from) <= EPS &&
      (piece.toEnd || (end !== null && Math.abs(end.timestamp - piece.to) <= EPS))
    if (!aligned || !start) {
      yield* recodeFrames(segment, track, piece.from, piece.to, false, resume)
      return
    }

    // Going on from a place inside the piece: begin at the key packet in
    // front of it.
    let begin = start
    if (resume > segment.offset) {
      const looking = performance.now()
      const key = await sink.getKeyPacket(sourceTime(segment, resume) + EPS)
      timing.seekMs += performance.now() - looking
      if (key && key.timestamp > start.timestamp) begin = key
    }

    // A GOP that can be copied, with its packets moved onto the output's
    // parameter sets; null when it has to be encoded again. An H.264 GOP
    // has to start with an IDR picture, the only one that may switch the
    // sequence parameter set.
    const readyGop = (gop: EncodedPacket[], from: number, until: number): EncodedPacket[] | null => {
      if (!isClosedGop(gop.map((packet) => packet.timestamp), from, until, EPS)) return null
      if (!registry) return gop
      const head = gop[0]
      if (!head || !startsWithIdr(head.data, registry.lengthSize)) return null
      const moved: EncodedPacket[] = []
      let changed = 0
      for (const packet of gop) {
        const next = moveToOutput(packet, segment.clip.sourceId)
        if (!next) return null
        if (next !== packet) changed++
        moved.push(next)
      }
      counts.rewritten += changed
      return moved
    }

    const sendGop = async function* (
      gop: EncodedPacket[],
      from: number,
      until: number,
    ): AsyncGenerator<VideoItem> {
      const ready = readyGop(gop, from, until)
      if (!ready) {
        counts.fallbackGops++
        yield* recodeFrames(segment, track, from, Math.min(until, piece.to), false, resume)
        return
      }
      for (const packet of ready) {
        const time = Math.max(segment.offset, segment.offset + packet.timestamp - segment.start)
        yield { kind: 'packet', time, packet: packet.clone({ timestamp: time }) }
      }
    }

    let gop: EncodedPacket[] = []
    let gopStart = begin.timestamp
    for await (const packet of pulled(sink.packets(begin, end ?? undefined), (ms) => (timing.readMs += ms))) {
      if (packet.type === 'key' && gop.length > 0) {
        yield* sendGop(gop, gopStart, packet.timestamp)
        gop = []
        gopStart = packet.timestamp
      }
      gop.push(packet)
    }
    if (gop.length > 0) {
      yield* sendGop(gop, gopStart, piece.toEnd ? Infinity : piece.to)
    }
  }

  async function* items(from = 0): AsyncGenerator<VideoItem> {
    began ??= performance.now()
    for (const piece of pieces) {
      const segment = segments[piece.segment]
      const track = opened.tracksOf(segment).video
      if (!track) continue
      if (from > 0 && !(piece.kind === 'copy' && piece.toEnd) && segment.offset + (piece.to - segment.start) <= from) {
        continue
      }
      if (piece.kind === 'copy') {
        yield* copyPackets(segment, track, piece, from)
      } else {
        const first = piece.from <= segment.start + EPS
        yield* recodeFrames(segment, track, piece.from, piece.to, first, from)
      }
    }
  }

  return { videoConfig, counts, timing, items, fromEncoder, sessionProblem }
}
