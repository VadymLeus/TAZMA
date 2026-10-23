// src/stand/crashRun.ts
import type { ExportOptions, ExportProgress, ExportProject, ExportResult, ExportSettings } from '../export/types.ts'
import type { WorkerFactory, WorkerLike } from '../export/worker/client.ts'
import type { Continuation } from '../resume/continueJob.ts'
import type { CrashFigures } from './record.ts'

export interface CrashDeps {
  // Runs one export with the given way of making workers.
  run: (
    project: ExportProject,
    settings: ExportSettings,
    options: ExportOptions,
    create: WorkerFactory,
  ) => Promise<ExportResult>
  // Makes a real worker.
  base: WorkerFactory
  // The jobs the private storage holds a journal of.
  listJobs: () => Promise<string[]>
  // The project and settings to go on with a job, as the resume dialog builds them.
  prepare: (job: string, current: ExportSettings) => Promise<Continuation>
  removeJob: (job: string) => Promise<void>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  // Calls `fn` after `ms`; the result stops it.
  timer?: (fn: () => void, ms: number) => () => void
}

export interface CrashPlan {
  // Milliseconds from the start of an attempt to its end by a cut, drawn anew
  // for each attempt.
  gap: () => number
  // Attempts after which the run is given up.
  maxAttempts?: number
  // How long a journal still held by the worker that was cut may be waited for.
  busyWaitMs?: number
}

export interface CrashOutcome {
  result: ExportResult
  figures: CrashFigures
}

export const CRASH_MESSAGE = 'Обрив, змодельований стендом'

const DEFAULT_ATTEMPTS = 200
const DEFAULT_BUSY_WAIT = 10_000
const BUSY_STEP = 50

const defaultTimer = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

interface Guard {
  create: WorkerFactory
  cancel: () => void
}

// Workers that die after `afterMs` as if the page had been killed: the real
// worker is ended without a word, and the client is told by the error event,
// which is what it gets when a worker script fails. The cut waits for the
// worker's "ready", since an error before it means "no worker" to the client,
// which would then run the export on the page.
function crashing(base: WorkerFactory, afterMs: number, timer: NonNullable<CrashDeps['timer']>, onCrash: () => void): Guard {
  const stops: (() => void)[] = []
  const create: WorkerFactory = () => {
    const real = base()
    let ready = false
    let due = false
    let over = false
    const proxy: WorkerLike = {
      postMessage: (message) => real.postMessage(message),
      terminate: () => {
        over = true
        real.terminate()
      },
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    }
    const crash = () => {
      if (over) return
      over = true
      onCrash()
      real.onmessage = null
      real.onerror = null
      real.onmessageerror = null
      real.terminate()
      proxy.onerror?.({ message: CRASH_MESSAGE })
    }
    real.onmessage = (event) => {
      if (over) return
      if (event.data.type === 'ready') ready = true
      proxy.onmessage?.(event)
      if (ready && due) crash()
    }
    real.onerror = (event) => {
      if (!over) proxy.onerror?.(event)
    }
    real.onmessageerror = (event) => {
      if (!over) proxy.onmessageerror?.(event)
    }
    stops.push(
      timer(() => {
        due = true
        if (ready) crash()
      }, Math.max(0, afterMs)),
    )
    return proxy
  }
  return { create, cancel: () => stops.forEach((stop) => stop()) }
}

const isBusy = (error: unknown) => error instanceof Error && error.name === 'JobBusy'

// An export that is cut short at the moments the plan sets, and goes on from
// its journal after each cut until it is done. The time the whole thing took
// is the caller's to measure; this gives the count of cuts, how many of the
// restarts had no journal to go on from and began again, and how long the
// restarts took until work was under way again.
export async function runWithCrashes(
  project: ExportProject,
  settings: ExportSettings,
  plan: CrashPlan,
  deps: CrashDeps,
  options: Pick<ExportOptions, 'signal' | 'onProgress'> = {},
): Promise<CrashOutcome> {
  const now = deps.now ?? (() => performance.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timer = deps.timer ?? defaultTimer
  const maxAttempts = plan.maxAttempts ?? DEFAULT_ATTEMPTS
  const busyWait = plan.busyWaitMs ?? DEFAULT_BUSY_WAIT
  const before = new Set(await deps.listJobs())
  const samples: number[] = []
  let job: string | null = null
  let crashes = 0
  let attempts = 0
  let fresh = 0
  let restartFrom: number | null = null

  const onProgress = (progress: ExportProgress) => {
    if (restartFrom !== null) {
      samples.push(now() - restartFrom)
      restartFrom = null
    }
    options.onProgress?.(progress)
  }

  const leftovers = async () => {
    const found = (await deps.listJobs()).filter((id) => !before.has(id))
    return found
  }

  try {
    while (true) {
      if (attempts >= maxAttempts) throw new Error(`Експорт не завершився за ${maxAttempts} спроб із обривами.`)
      attempts++
      const began = now()
      const gap = plan.gap()
      let current = project
      let currentSettings = settings
      if (attempts > 1) {
        // After a cut: go on from the journal if it holds anything to go on
        // from, otherwise the export begins again, as a person would do.
        const next = job ? await deps.prepare(job, settings) : null
        if (next?.ok) {
          current = next.project
          currentSettings = next.settings
        } else {
          if (job) await deps.removeJob(job).catch(() => {})
          job = null
          fresh++
        }
      }
      let waited = 0
      let cutAt: number | null = null
      while (cutAt === null) {
        const remaining = gap - (now() - began)
        if (remaining <= 0) {
          cutAt = now()
          break
        }
        const state = { cutAt: null as number | null }
        const guard = crashing(deps.base, remaining, timer, () => {
          state.cutAt = now()
        })
        try {
          const result = await deps.run(
            current,
            currentSettings,
            {
              ...(options.signal ? { signal: options.signal } : {}),
              onProgress,
              ...(job ? { resumeJob: job } : {}),
            },
            guard.create,
          )
          guard.cancel()
          const mean = samples.length > 0 ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null
          return { result, figures: { crashes, attempts, fresh, restartMs: mean } }
        } catch (error) {
          guard.cancel()
          if (state.cutAt !== null) {
            cutAt = state.cutAt
          } else if (isBusy(error) && job && waited < busyWait) {
            await sleep(BUSY_STEP)
            waited += BUSY_STEP
          } else {
            throw error
          }
        }
      }
      crashes++
      restartFrom = cutAt
      if (!job) {
        const found = await leftovers()
        if (found.length > 0) job = found[found.length - 1]
      }
    }
  } catch (error) {
    for (const id of await leftovers().catch(() => [] as string[])) await deps.removeJob(id).catch(() => {})
    throw error
  }
}
