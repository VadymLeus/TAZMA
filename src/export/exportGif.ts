// src/export/exportGif.ts
import { VideoSampleSink } from 'mediabunny'
import type { VideoSample } from 'mediabunny'
import { GifEncoder } from '../gif/gifEncoder.ts'
import { frameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import { composeFrame } from './compose.ts'
import { outputSize } from './geometry.ts'
import { tickCount, tickDelay, tickEnd, tickStart } from './gifTicks.ts'
import { buildSegments } from './plan.ts'
import type { Segment } from './plan.ts'
import { FALLBACK_FRAME, MIN_FRAME, openProject } from './shared.ts'
import type { OpenedProject } from './shared.ts'
import { ExportAborted } from './types.ts'
import type { ExportOptions, ExportProject, ExportResult, ExportSettings } from './types.ts'

// The colour step below which a pixel counts as unchanged between frames.
const TOLERANCE = 6
// Longest stretch of work before the page gets a moment to repaint.
const YIELD_MS = 50

type Held = { time: number; end: number; sample: VideoSample; segment: Segment }

// Source frames of the whole timeline in order, each with the time it is
// shown from and until.
async function* heldFrames(
  segments: Segment[],
  tracksOf: OpenedProject['tracksOf'],
): AsyncGenerator<Held> {
  for (const segment of segments) {
    const track = tracksOf(segment).video
    if (!track) continue
    const sink = new VideoSampleSink(track)
    const segmentEnd = segment.offset + segment.length
    for await (const sample of sink.samples(segment.start, segment.end)) {
      const time = segment.offset + Math.max(0, sample.timestamp - segment.start)
      const natural = sample.duration > 0 ? sample.duration : FALLBACK_FRAME
      const end = Math.min(time + natural, segmentEnd)
      if (end - time < MIN_FRAME) {
        sample.close()
        continue
      }
      yield { time, end, sample, segment }
    }
  }
}

// Exports the timeline as an animated GIF: no sound, a fixed frame rate, the
// frame of the source that is showing at each tick painted with its effect and
// captions, then packed by the GIF encoder.
export async function exportGif(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { clips, texts, sources } = project
  const { signal, onProgress } = options
  const total = timelineDuration(clips)
  if (clips.length === 0 || total <= 0) throw new Error('Таймлайн порожній.')

  const fps = settings.gifFps
  const size = outputSize(frameSize(clips, sources), settings.height)
  const segments = buildSegments(clips)
  const count = tickCount(total, fps)
  const startedAt = performance.now()
  const opened = await openProject(project, segments)

  try {
    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Не вдалося створити полотно для кадрів.')

    const chunks: Uint8Array[] = []
    const encoder = new GifEncoder(
      {
        width: size.width,
        height: size.height,
        loop: settings.gifLoop ? 0 : null,
        dither: settings.gifDither,
        tolerance: TOLERANCE,
      },
      (chunk) => chunks.push(chunk),
    )

    let tick = 0
    const previous: { data: Uint8ClampedArray | null } = { data: null }
    let lastYield = performance.now()
    const emit = (data: Uint8ClampedArray) => {
      encoder.addFrame(data, tickDelay(tick, count, total, fps))
      previous.data = data
      tick++
      onProgress?.({ time: tickEnd(tick - 1, count, total, fps), total, frames: tick })
    }
    for await (const held of heldFrames(segments, opened.tracksOf)) {
      try {
        const lastFrame = held.end >= total - MIN_FRAME
        while (tick < count && (tickStart(tick, fps) < held.end - MIN_FRAME || lastFrame)) {
          if (signal?.aborted) throw new ExportAborted()
          const time = tickStart(tick, fps)
          composeFrame(ctx, size.width, size.height, held.sample, held.segment.clip.effect, texts, time)
          emit(ctx.getImageData(0, 0, size.width, size.height).data)
          if (performance.now() - lastYield > YIELD_MS) {
            await new Promise<void>((resolve) => setTimeout(resolve))
            lastYield = performance.now()
          }
        }
      } finally {
        held.sample.close()
      }
      if (tick >= count) break
    }
    // Frame times that stop short of the end keep the last picture to the end.
    while (previous.data && tick < count) emit(previous.data)
    if (tick === 0) throw new Error('У проєкті немає кадрів відео.')
    encoder.finish()

    const blob = new Blob(chunks as BlobPart[], { type: 'image/gif' })
    return {
      blob,
      mimeType: 'image/gif',
      bytes: blob.size,
      elapsedMs: performance.now() - startedAt,
      frames: tick,
      width: size.width,
      height: size.height,
      duration: total,
      hasAudio: false,
      settings,
      stats: {
        mode: 'full',
        framesCopied: 0,
        framesRecoded: tick,
        copiedSeconds: 0,
        recodedSeconds: total,
        runs: 1,
        fallbackGops: 0,
        rewrittenPackets: 0,
      },
      release: async () => {},
    }
  } finally {
    opened.dispose()
  }
}
