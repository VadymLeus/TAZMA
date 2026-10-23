// src/resume/videoPass.ts
import { CanvasSource, NullTarget, Output, Quality, VideoSampleSink } from 'mediabunny'
import { composeFrame } from '../export/compose.ts'
import { createFormat } from '../export/codecs.ts'
import type { Segment } from '../export/plan.ts'
import type { StageTimes } from '../export/stageTimes.ts'
import type { SelectiveSource } from '../export/selectiveSource.ts'
import type { OpenedProject } from '../export/shared.ts'
import type { ExportProject, VideoSettings } from '../export/types.ts'
import type { FrameItem } from '../export/videoItems.ts'
import type { FlowControl } from '../pipeline/flowControl.ts'
import { configToStored, sameStream } from './configs.ts'
import { resumeTime } from './manifest.ts'
import type { Manifest } from './manifest.ts'
import { runParts } from './parts.ts'
import type { Engine, PartsResult } from './parts.ts'
import type { JournalStore } from './store.ts'

const SAME = 1e-9
// A frame this much before the place to go on from is still read, so that the
// first frame wanted is never the one before it.
const SEEK_MARGIN = 0.01

export interface VideoPassArgs {
  store: JournalStore
  manifest: Manifest
  settings: VideoSettings
  project: ExportProject
  size: { width: number; height: number }
  segments: Segment[]
  opened: OpenedProject
  // Given for a selective export: the video is then made of copied packets
  // and of the frames that are encoded again, as the plan says.
  selective?: SelectiveSource | null
  flow?: FlowControl | null
  signal?: AbortSignal
  onProgress?: (progress: { time: number; frames: number }) => void
}

export type VideoPassResult = PartsResult

export const STREAM_CHANGED =
  'Кодувальник у новому сеансі видав інші параметри потоку, тому частини журналу не можна з’єднати в один файл. Спробуйте експорт без журналу.'

const NOT_MOVED = 'Не вдалося перенести пакет H.264 у спільний потік.'

// The encoder sessions of the video pass: each paints frames on one canvas
// and encodes them into a track of an output that is thrown away, keeping
// only the packets.
function createEngine(args: VideoPassArgs): Engine {
  const { settings, project, size, flow } = args
  const quality = new Quality(settings.quality)
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null

  return {
    async open(emit, stages: StageTimes) {
      if (!canvas || !ctx) {
        canvas = new OffscreenCanvas(size.width, size.height)
        ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')
      }
      const painter = ctx
      const output = new Output({ format: createFormat(settings.container, false), target: new NullTarget() })
      const source = new CanvasSource(canvas, {
        codec: settings.videoCodec,
        quality,
        onEncodedPacket: (packet, meta) => {
          flow?.encoded(1)
          emit(packet, meta)
        },
      })
      output.addVideoTrack(source)
      await output.start()
      return {
        async add(item, duration) {
          const painting = performance.now()
          composeFrame(painter, size.width, size.height, item.sample, item.segment.clip.effect, project.texts, item.time)
          const encoding = performance.now()
          await source.add(item.time, duration)
          const added = performance.now() - encoding
          stages.composeMs += encoding - painting
          stages.encodeMs += added
          stages.firstAddMs ??= added
          flow?.handOff()
        },
        async end() {
          source.close()
          await output.finalize()
          flow?.settle()
        },
        async cancel() {
          if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
        },
      }
    },
  }
}

// Every frame of the timeline from the place to go on from, in order.
async function* framesFrom(args: VideoPassArgs, from: number): AsyncGenerator<FrameItem> {
  const { segments, opened } = args
  for (const segment of segments) {
    if (segment.offset + segment.length <= from + SAME && from > 0) continue
    const track = opened.tracksOf(segment).video
    if (!track) continue
    const sink = new VideoSampleSink(track)
    const startAt = from > segment.offset ? segment.start + (from - segment.offset) - SEEK_MARGIN : segment.start
    for await (const sample of sink.samples(Math.max(segment.start, startAt), segment.end)) {
      const time = segment.offset + Math.max(0, sample.timestamp - segment.start)
      yield { kind: 'frame', time, sample, segment }
    }
  }
}

// Encodes the video in parts. Every part is a session of the encoder of its
// own, which starts with a key frame, so a part depends on nothing before it.
// A finished part is written to the journal and listed in the manifest; the
// export can go on from the last one listed. In a selective export the parts
// also hold the packets that are copied from the source files.
export async function encodeVideo(args: VideoPassArgs): Promise<VideoPassResult> {
  const { store, manifest, selective, signal, onProgress } = args
  const from = resumeTime(manifest)

  if (selective) {
    if (manifest.videoConfig && !sameStream(manifest.videoConfig, selective.videoConfig)) {
      throw new Error(STREAM_CHANGED)
    }
    const result = await runParts({
      store,
      manifest,
      items: selective.items(from),
      engine: createEngine(args),
      config: configToStored(selective.videoConfig),
      accept: (packet, meta, first) => {
        if (first) {
          const problem = selective.sessionProblem(meta)
          if (problem) throw problem
        }
        const moved = selective.fromEncoder(packet.clone())
        if (!moved) throw new Error(NOT_MOVED)
        return moved
      },
      signal,
      onProgress,
    })
    Object.assign(result.stages, selective.timing)
    return result
  }

  return runParts({
    store,
    manifest,
    items: framesFrom(args, from),
    engine: createEngine(args),
    config: null,
    accept: (packet, meta, first, known) => {
      if (!first) return packet
      const config = meta?.decoderConfig
      if (!config) throw new Error('Кодувальник не повернув параметрів потоку.')
      if (known && !sameStream(known, config)) throw new Error(STREAM_CHANGED)
      return packet
    },
    signal,
    onProgress,
  })
}
