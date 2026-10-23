// tests/lock.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JobBusy, activeJobs, holdJob } from '../src/resume/lock.ts'
import type { LockManagerLike } from '../src/resume/lock.ts'

function fakeLocks(): LockManagerLike {
  const held = new Set<string>()
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null)
      held.add(name)
      try {
        return await callback({})
      } finally {
        held.delete(name)
      }
    },
    async query() {
      return { held: [...held].map((name) => ({ name })) }
    },
  }
}

describe('holdJob', () => {
  it('runs the work and frees the job afterwards', async () => {
    const locks = fakeLocks()
    assert.equal(await holdJob('a', async () => 42, locks), 42)
    assert.equal(await holdJob('a', async () => 43, locks), 43)
  })

  it('refuses a job that is already held', async () => {
    const locks = fakeLocks()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = holdJob('a', () => gate, locks)
    await assert.rejects(holdJob('a', async () => 1, locks), JobBusy)
    assert.equal(await holdJob('b', async () => 2, locks), 2)
    release()
    await first
  })

  it('frees the job when the work fails', async () => {
    const locks = fakeLocks()
    await assert.rejects(holdJob('a', async () => {
      throw new Error('збій')
    }, locks), /збій/)
    assert.equal(await holdJob('a', async () => 1, locks), 1)
  })

  it('runs without a lock manager', async () => {
    assert.equal(await holdJob('a', async () => 7, null), 7)
  })
})

describe('activeJobs', () => {
  it('lists the jobs that are held, and only those', async () => {
    const locks = fakeLocks()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = holdJob('job-1', () => gate, locks)
    await locks.request('somebody-else', { ifAvailable: true }, async () => {
      assert.deepEqual([...(await activeJobs(locks))], ['job-1'])
    })
    release()
    await first
    assert.equal((await activeJobs(locks)).size, 0)
  })

  it('is empty without a lock manager', async () => {
    assert.equal((await activeJobs(null)).size, 0)
  })
})
