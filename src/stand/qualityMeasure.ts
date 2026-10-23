// src/stand/qualityMeasure.ts
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import { composeFrame } from '../export/compose.ts'
import type { ExportProject } from '../export/types.ts'
import { locate, timelineDuration } from '../project/timeline.ts'
import { compareFrames, sampleTimes, summarizeQuality } from './quality.ts'
import type { FrameQuality, QualityReport } from './quality.ts'

export interface QualityTarget {
  width: number
  height: number
  frameRate: number
}

// Compares frames of an exported file with the frames the project asks for: the
// source frame at the same time, painted with the clip's effect and the
// captions as the export paints them. Only for the projects of the stand,
// whose clips follow one another in one file. Null if a track is missing.
export async function measureQuality(
  project: ExportProject,
  output: Blob,
  target: QualityTarget,
  count: number,
  signal?: AbortSignal,
): Promise<QualityReport | null> {
  const source = project.sources[0]
  if (!source) return null
  const reference = new Input({ formats: ALL_FORMATS, source: new BlobSource(source.file) })
  const exported = new Input({ formats: ALL_FORMATS, source: new BlobSource(output) })
  try {
    const [referenceTrack, outputTrack] = await Promise.all([reference.getPrimaryVideoTrack(), exported.getPrimaryVideoTrack()])
    if (!referenceTrack || !outputTrack) return null
    const referenceSink = new VideoSampleSink(referenceTrack)
    const outputSink = new VideoSampleSink(outputTrack)
    const { width, height } = target
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Не вдалося створити полотно для порівняння.')
    const pixels = () => ctx.getImageData(0, 0, width, height).data

    const results: FrameQuality[] = []
    for (const time of sampleTimes(timelineDuration(project.clips), count, target.frameRate)) {
      if (signal?.aborted) break
      const place = locate(project.clips, time)
      if (!place) continue
      const clip = project.clips[place.index]
      const wanted = referenceSink.getSample(clip.start + place.offset)
      const got = outputSink.getSample(time)
      const [referenceSample, outputSample] = await Promise.all([wanted, got])
      try {
        if (!referenceSample || !outputSample) continue
        composeFrame(ctx, width, height, referenceSample, clip.effect, project.texts, time)
        const expected = Uint8ClampedArray.from(pixels())
        ctx.filter = 'none'
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)
        outputSample.drawWithFit(ctx, { fit: 'contain' })
        results.push(compareFrames(expected, pixels(), width, height))
      } finally {
        referenceSample?.close()
        outputSample?.close()
      }
    }
    return summarizeQuality(results)
  } finally {
    reference.dispose()
    exported.dispose()
  }
}
