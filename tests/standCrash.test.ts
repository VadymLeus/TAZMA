// tests/standCrash.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runInWorker } from '../src/export/worker/client.ts'
import type { WorkerFactory, WorkerLike } from '../src/export/worker/client.ts'
import type { FromWorker, ToWorker, WireResult } from '../src/export/worker/protocol.ts'
import type { ExportProgress, ExportProject, ExportSettings } from '../src/export/types.ts'
import type { Continuation } from '../src/resume/continueJob.ts'
import { runWithCrashes } from '../src/stand/crashRun.ts'
import type { CrashDeps } from '../src/stand/crashRun.ts'

const project = { clips: [], texts: [], sources: [] } as unknown as ExportProject
const settings = { container: 'mp4' } as unknown as ExportSettings

interface Script {
  // When "ready" is posted, when the journal appears, when the export is done.
  ready: number
  journal: number
  done: number
  // The export ends in an error and leaves its journal.
  fail?: boolean
}

// A worker that plays out an export with timers, and leaves no timer behind
// once it is ended.
class ScriptedWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private script: Script
  private jobs: string[]
  private name: string
  constructor(script: Script, jobs: string[], name: string) {
    this.script = script
    this.jobs = jobs
    this.name = name
  }
  private say(message: FromWorker) {
    this.onmessage?.({ data: message })
  }
  postMessage(message: ToWorker) {
    if (message.type !== 'start') return
    const { ready, journal, done } = this.script
    this.timers.push(setTimeout(() => this.say({ type: 'ready' }), ready))
    if (message.resumeJob === undefined) this.timers.push(setTimeout(() => this.jobs.push(this.name), journal))
    this.timers.push(setTimeout(() => this.say({ type: 'progress', progress: { time: 1, total: 2, frames: 1 } }), ready + 2))
    this.timers.push(
      setTimeout(() => {
        if (this.script.fail) {
          this.say({ type: 'error', error: { name: 'Error', message: 'decoder failed' } })
          return
        }
        const at = this.jobs.indexOf(message.resumeJob ?? this.name)
        if (at >= 0) this.jobs.splice(at, 1)
        this.say({ type: 'done', result: { bytes: 1, frames: 1, file: null } as unknown as WireResult })
      }, done),
    )
  }
  terminate() {
    this.timers.forEach(clearTimeout)
  }
}

function setup(script: Partial<Script> = {}, wrap?: (run: CrashDeps['run']) => CrashDeps['run']) {
  const jobs: string[] = []
  const full: Script = { ready: 1, journal: 10, done: 80, ...script }
  let made = 0
  const base: WorkerFactory = () => new ScriptedWorker(full, jobs, `job-${++made}`)
  const removed: string[] = []
  const prepared: string[] = []
  const errors: unknown[] = []
  const run: CrashDeps['run'] = async (p, s, o, create) => {
    try {
      return await runInWorker(p, s, { ...o, discard: async () => {} }, create)
    } catch (error) {
      errors.push(error)
      throw error
    }
  }
  const deps: CrashDeps = {
    run: wrap ? wrap(run) : run,
    base,
    listJobs: async () => [...jobs],
    prepare: async (job): Promise<Continuation> => {
      prepared.push(job)
      return { ok: true, project, settings }
    },
    removeJob: async (job) => {
      removed.push(job)
      const at = jobs.indexOf(job)
      if (at >= 0) jobs.splice(at, 1)
    },
    sleep: async () => {},
  }
  return { deps, jobs, removed, prepared, errors, made: () => made }
}

const gaps = (...values: number[]) => {
  const list = [...values]
  return () => list.shift() ?? 1e9
}

describe('runWithCrashes', () => {
  it('finishes in one attempt when no cut comes in time', async () => {
    const { deps, prepared } = setup()
    const outcome = await runWithCrashes(project, settings, { gap: gaps(1e9) }, deps)
    assert.deepEqual(outcome.figures, { crashes: 0, attempts: 1, fresh: 0, restartMs: null })
    assert.deepEqual(prepared, [])
  })

  it('goes on from the journal after a cut', async () => {
    const { deps, prepared, jobs } = setup()
    const resumed: (string | undefined)[] = []
    const seen = deps.run
    deps.run = (p, s, o, create) => {
      resumed.push(o.resumeJob)
      return seen(p, s, o, create)
    }
    const outcome = await runWithCrashes(project, settings, { gap: gaps(40, 1e9) }, deps)
    assert.equal(outcome.figures.crashes, 1)
    assert.equal(outcome.figures.attempts, 2)
    assert.equal(outcome.figures.fresh, 0)
    assert.ok(outcome.figures.restartMs !== null && outcome.figures.restartMs >= 0)
    assert.deepEqual(prepared, ['job-1'])
    assert.deepEqual(resumed, [undefined, 'job-1'])
    assert.deepEqual(jobs, [])
  })

  it('starts over when the cut came before any journal existed', async () => {
    const { deps, prepared } = setup()
    const resumed: (string | undefined)[] = []
    const seen = deps.run
    deps.run = (p, s, o, create) => {
      resumed.push(o.resumeJob)
      return seen(p, s, o, create)
    }
    const outcome = await runWithCrashes(project, settings, { gap: gaps(4, 1e9) }, deps)
    assert.equal(outcome.figures.crashes, 1)
    assert.deepEqual(prepared, [])
    assert.deepEqual(resumed, [undefined, undefined])
    assert.equal(outcome.figures.fresh, 1)
  })

  it('starts over, and clears the journal, when the one a cut left cannot be read', async () => {
    const { deps, removed } = setup()
    deps.prepare = async () => ({ ok: false, message: 'no recipe', missing: [] })
    const resumed: (string | undefined)[] = []
    const seen = deps.run
    deps.run = (p, s, o, create) => {
      resumed.push(o.resumeJob)
      return seen(p, s, o, create)
    }
    const outcome = await runWithCrashes(project, settings, { gap: gaps(40, 1e9) }, deps)
    assert.equal(outcome.figures.fresh, 1)
    assert.deepEqual(removed, ['job-1'])
    assert.deepEqual(resumed, [undefined, undefined])
  })

  it('counts a cut that falls before the worker said it was ready as a cut, not as a missing worker', async () => {
    const { deps, errors } = setup({ ready: 30, journal: 40, done: 90 })
    const outcome = await runWithCrashes(project, settings, { gap: gaps(5, 1e9) }, deps)
    assert.equal(outcome.figures.crashes, 1)
    assert.equal((errors[0] as Error).name, 'Error')
    assert.match((errors[0] as Error).message, /Фоновий потік зупинився/)
  })

  it('treats an attempt whose time ran out while it was getting ready as cut', async () => {
    const { deps } = setup()
    const outcome = await runWithCrashes(project, settings, { gap: gaps(40, 0, 1e9) }, deps)
    assert.equal(outcome.figures.crashes, 2)
    assert.equal(outcome.figures.attempts, 3)
  })

  it('waits while the cut worker still holds the journal', async () => {
    const { deps } = setup()
    let busy = 2
    const seen = deps.run
    deps.run = (p, s, o, create) => {
      if (o.resumeJob !== undefined && busy-- > 0) {
        return Promise.reject(Object.assign(new Error('busy'), { name: 'JobBusy' }))
      }
      return seen(p, s, o, create)
    }
    const outcome = await runWithCrashes(project, settings, { gap: gaps(40, 1e9) }, deps)
    assert.equal(outcome.figures.crashes, 1)
    assert.equal(busy, -1)
  })

  it('gives up on a journal that stays held, and removes it', async () => {
    const { deps, removed } = setup()
    const seen = deps.run
    deps.run = (p, s, o, create) =>
      o.resumeJob !== undefined
        ? Promise.reject(Object.assign(new Error('busy'), { name: 'JobBusy' }))
        : seen(p, s, o, create)
    await assert.rejects(runWithCrashes(project, settings, { gap: gaps(40, 1e9), busyWaitMs: 200 }, deps), /busy/)
    assert.deepEqual(removed, ['job-1'])
  })

  it('stops after the most attempts and leaves no journal', async () => {
    const { deps, removed } = setup({ done: 200 })
    await assert.rejects(runWithCrashes(project, settings, { gap: () => 25, maxAttempts: 3 }, deps), /3 спроб/)
    assert.deepEqual(removed, ['job-1'])
  })

  it('lets an error that is not a cut through and removes the journal it left', async () => {
    const { deps, removed } = setup({ fail: true })
    await assert.rejects(runWithCrashes(project, settings, { gap: gaps(1e9) }, deps), /decoder failed/)
    assert.deepEqual(removed, ['job-1'])
  })

  it('does not touch journals that were there before', async () => {
    const { deps, jobs, removed } = setup()
    jobs.push('old')
    const outcome = await runWithCrashes(project, settings, { gap: gaps(40, 1e9) }, deps)
    assert.equal(outcome.figures.crashes, 1)
    assert.deepEqual(removed, [])
    assert.deepEqual(jobs, ['old'])
  })

  it('passes progress on', async () => {
    const { deps } = setup()
    const seen: number[] = []
    await runWithCrashes(project, settings, { gap: gaps(1e9) }, deps, { onProgress: (p: ExportProgress) => seen.push(p.time) })
    assert.ok(seen.length > 0)
  })
})
