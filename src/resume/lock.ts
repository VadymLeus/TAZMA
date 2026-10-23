// src/resume/lock.ts

const PREFIX = 'tazma-job-'

// The part of the browser's lock manager that is used, so that a fake can
// stand in for it.
export interface LockManagerLike {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: object | null) => Promise<T>,
  ): Promise<T>
  query(): Promise<{ held?: { name?: string }[] }>
}

// Another export, in this tab or another, is working on the same journal.
export class JobBusy extends Error {
  constructor() {
    super('Цей експорт уже виконується в іншій вкладці або вікні.')
    this.name = 'JobBusy'
  }
}

function browserLocks(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null
  const locks = (navigator as unknown as { locks?: LockManagerLike }).locks
  return locks ?? null
}

// Runs `run` while holding the lock of a job. Two exports writing into one
// journal would damage it, so a job that is already held is refused. The lock
// goes with the page: if it dies, the job is free again. Where the browser has
// no lock manager the export runs without one.
export async function holdJob<T>(
  job: string,
  run: () => Promise<T>,
  locks: LockManagerLike | null = browserLocks(),
): Promise<T> {
  if (!locks) return run()
  return locks.request(PREFIX + job, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new JobBusy()
    return run()
  })
}

// The jobs some export holds right now.
export async function activeJobs(locks: LockManagerLike | null = browserLocks()): Promise<Set<string>> {
  const jobs = new Set<string>()
  if (!locks) return jobs
  const state = await locks.query()
  for (const item of state.held ?? []) {
    if (item.name?.startsWith(PREFIX)) jobs.add(item.name.slice(PREFIX.length))
  }
  return jobs
}
