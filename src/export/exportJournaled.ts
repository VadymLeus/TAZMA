// src/export/exportJournaled.ts
import { frameSize } from '../project/frame.ts'
import { timelineDuration } from '../project/timeline.ts'
import { assemble } from '../resume/assemble.ts'
import { encodeAudio } from '../resume/audioPass.ts'
import { DEFAULT_SEGMENT_SECONDS } from '../resume/cuts.ts'
import { fingerprintOf } from '../resume/fingerprint.ts'
import { writeManifest } from '../resume/journal.ts'
import { makeRecipe, resumeTime, withComplete } from '../resume/manifest.ts'
import { openJournal } from '../resume/session.ts'
import { encodeVideo } from '../resume/videoPass.ts'
import { createSink } from './sink.ts'
import type { ResultSink } from './sink.ts'
import { outputSize } from './geometry.ts'
import { buildSegments } from './plan.ts'
import { prepareSelective } from './selectiveSource.ts'
import { openProject } from './shared.ts'
import type { ExportOptions, ExportProject, ExportResult, JournalReport, VideoSettings } from './types.ts'

const SAME = 1e-6

// An export written through a journal: the full re-encode or the selective
// one. The sound is encoded first, in one pass; the video is written in parts
// (encoded, and in the selective mode also copied from the source files), each
// of them committed to the journal when it is closed; at the end the file is
// built from the journal alone. If the export stops, what the journal holds is
// not lost: the next run goes on from the last part (or from where the sound
// was done).
export async function exportJournaled(
  project: ExportProject,
  settings: VideoSettings,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const { clips, sources } = project
  const { signal, onProgress, flow, journal } = options
  if (!journal) throw new Error('Для відновлюваного експорту потрібен журнал.')
  const total = timelineDuration(clips)
  if (clips.length === 0 || total <= 0) throw new Error('Таймлайн порожній.')

  const size = outputSize(frameSize(clips, sources), settings.height)
  const segments = buildSegments(clips)
  const startedAt = performance.now()
  let sink: ResultSink | null = null
  const opened = await openProject(project, segments)

  try {
    const { store } = journal
    const fingerprint = await fingerprintOf(project, settings)
    const start = await openJournal(
      store,
      {
        job: journal.job,
        fingerprint,
        total,
        segmentSeconds: settings.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS,
        recipe: makeRecipe(project, settings),
        hasAudio: opened.hasAudio,
        now: Date.now(),
      },
      journal.resume ?? false,
      journal.depth ?? 'size',
    )
    let manifest = start.manifest
    const resumedFrom = resumeTime(manifest)

    let audioMs = 0
    if (manifest.audioState === 'pending') {
      const began = performance.now()
      manifest = await encodeAudio({
        store,
        manifest,
        settings,
        segments,
        opened,
        signal,
        onProgress: (time) => onProgress?.({ time, total, frames: 0, phase: 'audio' }),
      })
      audioMs = performance.now() - began
    }

    const videoBegan = performance.now()
    const selective =
      settings.mode === 'selective' && resumeTime(manifest) < total - SAME
        ? await prepareSelective({ segments, texts: project.texts, opened, settings, size, signal })
        : null
    const video = await encodeVideo({
      store,
      manifest,
      settings,
      project,
      size,
      segments,
      opened,
      selective,
      flow,
      signal,
      onProgress: ({ time, frames }) => onProgress?.({ time, total, frames, phase: 'video' }),
    })
    manifest = video.manifest
    const videoMs = performance.now() - videoBegan
    if (manifest.segments.length === 0) throw new Error('У проєкті немає відео, яке можна закодувати.')
    if (resumeTime(manifest) < total - SAME) throw new Error('Відео закодовано не до кінця таймлайну.')
    if (!manifest.complete) {
      manifest = withComplete(manifest, Date.now())
      await writeManifest(store, manifest)
    }

    const assembleBegan = performance.now()
    sink = await createSink(settings.container)
    const built = await assemble({
      store,
      manifest,
      settings,
      sink,
      signal,
      onProgress: ({ time, frames }) => onProgress?.({ time, total, frames, phase: 'assemble' }),
    })
    const blob = await sink.finish(built.mimeType)
    const assembleMs = performance.now() - assembleBegan

    const finished = sink
    const copiedPackets = manifest.segments.reduce((sum, record) => sum + (record.copied?.packets ?? 0), 0)
    const copiedSeconds = manifest.segments.reduce((sum, record) => sum + (record.copied?.seconds ?? 0), 0)
    const report: JournalReport = {
      job: journal.job,
      segments: manifest.segments.length,
      segmentSeconds: manifest.segmentSeconds,
      resumedFrom,
      journalBytes:
        manifest.segments.reduce((sum, record) => sum + record.bytes, 0) + (manifest.audio?.bytes ?? 0),
      commits: video.commits,
      commitMs: video.commitMs,
      checkpointMs: video.checkpointMs,
      audioMs,
      videoMs,
      assembleMs,
    }
    return {
      blob,
      mimeType: built.mimeType,
      bytes: blob.size,
      elapsedMs: performance.now() - startedAt,
      frames: built.frames,
      width: size.width,
      height: size.height,
      duration: total,
      hasAudio: opened.hasAudio,
      notes: [...start.notes, ...manifest.notes],
      file: finished.name,
      settings,
      stats: {
        mode: settings.mode,
        framesCopied: copiedPackets,
        framesRecoded: built.frames - copiedPackets,
        copiedSeconds,
        // What the journal held before this run counts with what this run encoded;
        // the copied seconds of the earlier parts are taken off.
        recodedSeconds: resumedFrom - (copiedSeconds - video.copiedSeconds) + video.seconds,
        runs: selective ? video.sessions : manifest.segments.length,
        fallbackGops: selective?.counts.fallbackGops ?? 0,
        rewrittenPackets: selective?.counts.rewritten ?? 0,
      },
      journal: report,
      release: () => finished.discard(),
    }
  } catch (error) {
    await sink?.discard()
    throw error
  } finally {
    opened.dispose()
  }
}
