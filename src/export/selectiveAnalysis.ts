// src/export/selectiveAnalysis.ts
import { CanvasSource, EncodedPacketSink, NullTarget, Output, Quality } from 'mediabunny'
import type { InputVideoTrack } from 'mediabunny'
import { frameSize } from '../project/frame.ts'
import type { FrameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import { createFormat } from './codecs.ts'
import { outputSize } from './geometry.ts'
import { buildSegments } from './plan.ts'
import type { Segment } from './plan.ts'
import { copyBlockers, planSelective, summarizePlan } from './selectivePlan.ts'
import type {
  CopyBlocker,
  Piece,
  PlanSummary,
  SegmentAnalysis,
  SourceStream,
  TargetStream,
} from './selectivePlan.ts'
import { openProject } from './shared.ts'
import type { OpenedProject } from './shared.ts'
import { ExportAborted } from './types.ts'
import type { ExportProject, VideoSettings } from './types.ts'

export interface EncoderProbe {
  // The decoder config our encoder attaches to its output; the output track
  // is described by it.
  config: VideoDecoderConfig
  description: Uint8Array | null
}

export function toBytes(data: AllowSharedBufferSource | undefined | null): Uint8Array | null {
  if (!data) return null
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(data as ArrayBuffer)
}

// Encodes one black frame to learn the stream parameters the encoder produces
// for these settings; they decide whether source packets can share the track.
export async function probeEncoder(
  settings: VideoSettings,
  size: FrameSize,
): Promise<EncoderProbe> {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size.width, size.height)

  let config: VideoDecoderConfig | undefined
  const output = new Output({
    format: createFormat(settings.container, false),
    target: new NullTarget(),
  })
  const source = new CanvasSource(canvas, {
    codec: settings.videoCodec,
    quality: new Quality(settings.quality),
    onEncodedPacket: (_packet, meta) => {
      config ??= meta?.decoderConfig
    },
  })
  output.addVideoTrack(source)
  await output.start()
  await source.add(0, 1 / 30)
  source.close()
  await output.finalize()
  if (!config) throw new Error('Кодувальник не повернув параметрів потоку.')
  return { config, description: toBytes(config.description) }
}

async function streamInfo(track: InputVideoTrack | null): Promise<SourceStream | null> {
  if (!track) return null
  const config = await track.getDecoderConfig()
  return {
    codec: await track.getCodec(),
    codecString: await track.getCodecParameterString(),
    description: toBytes(config?.description),
    width: await track.getCodedWidth(),
    height: await track.getCodedHeight(),
    rotation: await track.getRotation(),
    color: config?.colorSpace ?? null,
  }
}

// Key packets around [start, end]: the one at or before start and one past
// the end. Their types are checked in the bitstream, not taken on trust.
async function keyframesAround(
  sink: EncodedPacketSink,
  start: number,
  end: number,
): Promise<number[]> {
  const keys: number[] = []
  let packet =
    (await sink.getKeyPacket(start, { verifyKeyPackets: true })) ??
    (await sink.getFirstKeyPacket({ verifyKeyPackets: true }))
  while (packet) {
    keys.push(packet.timestamp)
    if (packet.timestamp >= end) break
    packet = await sink.getNextKeyPacket(packet, { verifyKeyPackets: true })
  }
  return keys
}

export interface ProjectAnalysis {
  analyses: SegmentAnalysis[]
  // Per source file: why its video cannot be copied, or null when it can.
  verdicts: Map<string, CopyBlocker | null>
  // Every reason per source, with the stream parameters they were judged on.
  blockers: Map<string, CopyBlocker[]>
  streams: Map<string, SourceStream | null>
  target: TargetStream
  encoder: EncoderProbe
}

export async function analyzeProject(
  segments: Segment[],
  opened: OpenedProject,
  settings: VideoSettings,
  size: FrameSize,
  signal?: AbortSignal,
): Promise<ProjectAnalysis> {
  const encoder = await probeEncoder(settings, size)
  const target: TargetStream = {
    codec: settings.videoCodec,
    codecString: encoder.config.codec,
    description: encoder.description,
    width: size.width,
    height: size.height,
    color: encoder.config.colorSpace ?? null,
  }
  const verdicts = new Map<string, CopyBlocker | null>()
  const blockers = new Map<string, CopyBlocker[]>()
  const streams = new Map<string, SourceStream | null>()
  const analyses: SegmentAnalysis[] = []
  for (const segment of segments) {
    if (signal?.aborted) throw new ExportAborted()
    const sourceId = segment.clip.sourceId
    const track = opened.tracksOf(segment).video
    if (!verdicts.has(sourceId)) {
      const info = await streamInfo(track)
      const found = copyBlockers(info, target, { ignoreColor: settings.ignoreColor })
      streams.set(sourceId, info)
      blockers.set(sourceId, found)
      verdicts.set(sourceId, found[0] ?? null)
    }
    if (verdicts.get(sourceId) !== null || !track) {
      analyses.push({ keyframes: [], streamEnd: 0, copyable: false })
      continue
    }
    const sink = new EncodedPacketSink(track)
    analyses.push({
      keyframes: await keyframesAround(sink, segment.start, segment.end),
      streamEnd: await track.computeDuration(),
      copyable: true,
    })
  }
  return { analyses, verdicts, blockers, streams, target, encoder }
}

export interface ProjectPlan {
  pieces: Piece[]
  summary: PlanSummary
  total: number
  verdicts: Map<string, CopyBlocker | null>
  blockers: Map<string, CopyBlocker[]>
  streams: Map<string, SourceStream | null>
  target: TargetStream
}

// What a selective export would copy and what it would recode, without
// encoding anything; the export dialog shows this before the start.
export async function planProject(
  project: ExportProject,
  settings: VideoSettings,
  signal?: AbortSignal,
): Promise<ProjectPlan> {
  const total = timelineDuration(project.clips)
  const size = outputSize(frameSize(project.clips, project.sources), settings.height)
  const segments = buildSegments(project.clips)
  const opened = await openProject(project, segments)
  try {
    const analysis = await analyzeProject(segments, opened, settings, size, signal)
    const pieces = planSelective(segments, project.texts, analysis.analyses)
    return {
      pieces,
      summary: summarizePlan(pieces),
      total,
      verdicts: analysis.verdicts,
      blockers: analysis.blockers,
      streams: analysis.streams,
      target: analysis.target,
    }
  } finally {
    opened.dispose()
  }
}
