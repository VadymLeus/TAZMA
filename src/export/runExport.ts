// src/export/runExport.ts
import { installDecoderTrace } from '../diagnostics/decoderTrace.ts'
import type { TraceHost } from '../diagnostics/decoderTrace.ts'
import { startMemoryRun } from '../diagnostics/memoryTrace.ts'
import { FlowControl } from '../pipeline/flowControl.ts'
import { frameSize } from '../project/frame.ts'
import { outputSize } from './geometry.ts'
import { holdJob } from '../resume/lock.ts'
import { openJobStore, removeJob } from '../resume/store.ts'
import { exportGif } from './exportGif.ts'
import { exportJournaled } from './exportJournaled.ts'
import { exportProject } from './exportProject.ts'
import { attemptLabel, planAttempts } from './attempts.ts'
import type { FailedAttempt } from './attempts.ts'
import { isDecoderError } from './errors.ts'
import { exportSelective } from './exportSelective.ts'
import { isVideoSettings } from './types.ts'
import type {
  ExportOptions,
  ExportProject,
  ExportResult,
  ExportSettings,
  JournalOptions,
  VideoSettings,
} from './types.ts'

const MIB = 1024 * 1024

function dispatch(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions,
): Promise<ExportResult> {
  if (!isVideoSettings(settings)) return exportGif(project, settings, options)
  if (options.journal) return exportJournaled(project, settings, options)
  return settings.mode === 'selective'
    ? exportSelective(project, settings, options)
    : exportProject(project, settings, options)
}

const wantsJournal = (settings: ExportSettings): boolean =>
  isVideoSettings(settings) && settings.resumable === true

const newJobId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const NO_JOURNAL = 'Журнал цього експорту не знайдено у сховищі браузера.'

const NO_STORAGE =
  'Приватне сховище браузера недоступне, тому експорт виконано без журналу: його не можна буде продовжити.'

// The journal of this export: the one the caller gave, the one of a job that
// is to be gone on with, or a new one in the browser's private storage. Null
// where there is no such storage.
async function prepareJournal(
  settings: ExportSettings,
  options: ExportOptions,
): Promise<JournalOptions | null> {
  const { resumeJob } = options
  if (resumeJob !== undefined) {
    if (!wantsJournal(settings)) {
      throw new Error('Продовжити можна лише експорт, що йде через журнал.')
    }
    const store = await openJobStore(resumeJob, false)
    if (!store) throw new Error(NO_JOURNAL)
    return { job: resumeJob, store, resume: true, depth: 'full', discard: () => removeJob(resumeJob) }
  }
  if (!wantsJournal(settings)) return null
  if (options.journal) return options.journal
  const job = newJobId()
  const store = await openJobStore(job)
  if (!store) return null
  return { job, store, discard: () => removeJob(job) }
}

// The limit is sized for the biggest frame that can be in the pipeline: a
// decoded frame of a source file or the frame the encoder is given.
function createFlow(project: ExportProject, settings: VideoSettings): FlowControl | null {
  if (settings.flow === 'library') return null
  const { clips, sources } = project
  const output = outputSize(frameSize(clips, sources), settings.height)
  let { width, height } = output
  for (const clip of clips) {
    const video = sources.find((source) => source.id === clip.sourceId)?.info.video
    if (video && video.width * video.height > width * height) {
      width = video.width
      height = video.height
    }
  }
  return new FlowControl({
    mode: settings.flow,
    limit: settings.flowLimit,
    budgetBytes: settings.memoryBudget * MIB,
    frameWidth: width,
    frameHeight: height,
  })
}

// Runs the export. If the decoder fails, the export is run again: without the
// frame limit, then with software decoding. A limit or a hardware decoder must
// not be the reason a file is not made, and the result says what it took.
export async function runExport(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const journal = await prepareJournal(settings, options)
  // Two exports must not write into one journal.
  if (journal) return holdJob(journal.job, () => runAttempts(project, settings, options, journal))
  return runAttempts(project, settings, options, null)
}

async function runAttempts(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions,
  journal: JournalOptions | null,
): Promise<ExportResult> {
  const attempts = planAttempts(isVideoSettings(settings) ? settings.flow : 'library')
  const failed: FailedAttempt[] = []
  const missing = wantsJournal(settings) && !journal
  for (const [index, attempt] of attempts.entries()) {
    const used = isVideoSettings(settings) ? { ...settings, flow: attempt.flow } : settings
    // A later attempt goes on from what the journal holds.
    const attemptJournal = journal ? { ...journal, resume: journal.resume || index > 0 } : null
    try {
      const result = await runOnce(project, used, { ...options, journal: attemptJournal }, attempt.software)
      await journal?.discard?.()
      const notes = missing ? [...(result.notes ?? []), NO_STORAGE] : result.notes
      return {
        ...result,
        notes,
        ...(failed.length > 0 ? { fallback: { failed, used: attempt } } : {}),
      }
    } catch (error) {
      if (options.signal?.aborted) await journal?.discard?.()
      if (options.signal?.aborted || !isDecoderError(error)) throw error
      failed.push({ attempt, error: error instanceof Error ? error.message : String(error) })
      if (index === attempts.length - 1) throw allFailed(error, failed)
    }
  }
  throw new Error('Немає способу виконати експорт')
}

// The error of the last attempt with the earlier ones in front of it.
function allFailed(last: unknown, failed: FailedAttempt[]): Error {
  const error = new Error(
    failed.map(({ attempt, error: message }) => `${attemptLabel(attempt)}: ${message}`).join('\n'),
    { cause: last },
  )
  error.name = last instanceof Error ? last.name : 'EncodingError'
  return error
}

async function runOnce(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions,
  software: boolean,
): Promise<ExportResult> {
  const flow = isVideoSettings(settings) ? createFlow(project, settings) : null
  const run = settings.recordMemory
    ? startMemoryRun(flow ? () => flow.snapshot() : undefined)
    : null
  try {
    const onProgress = run
      ? (progress: Parameters<NonNullable<ExportOptions['onProgress']>>[0]) => {
          // Only the video stage moves along the timeline of the readings.
          if (progress.phase === undefined || progress.phase === 'video') run.progress(progress.time)
          options.onProgress?.(progress)
        }
      : options.onProgress
    // The recorder and the gate go in after the frame counter and come out
    // before it, the gate first.
    const stopTrace = installDecoderTrace(globalThis as unknown as TraceHost, { software })
    let result: ExportResult
    try {
      flow?.install()
      try {
        result = await dispatch(project, settings, { ...options, onProgress, flow })
      } finally {
        flow?.uninstall()
      }
    } finally {
      stopTrace()
    }
    return { ...result, flow: flow?.report() ?? null, memory: run ? run.finish() : null }
  } finally {
    run?.dispose()
  }
}
