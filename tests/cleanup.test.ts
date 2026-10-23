// tests/cleanup.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JOURNAL_TTL_MS, removeStale, staleJobs } from '../src/resume/cleanup.ts'
import type { JobSummary } from '../src/resume/jobs.ts'

const NOW = 100 * 24 * 60 * 60 * 1000

const job = (name: string, over: Partial<JobSummary> = {}): JobSummary => ({
  job: name,
  created: NOW - 1000,
  updated: NOW - 1000,
  total: 90,
  covered: 30,
  segments: 1,
  bytes: 1000,
  audio: 'done',
  complete: false,
  sources: [],
  active: false,
  usable: true,
  problems: [],
  ...over,
})

describe('staleJobs', () => {
  it('picks the journals untouched for longer than the time to live', () => {
    const list = [
      job('fresh'),
      job('old', { updated: NOW - JOURNAL_TTL_MS - 1 }),
      job('edge', { updated: NOW - JOURNAL_TTL_MS }),
    ]
    assert.deepEqual(staleJobs(list, NOW).map((item) => item.job), ['old'])
  })

  it('leaves alone a journal another tab is working on', () => {
    assert.deepEqual(staleJobs([job('busy', { updated: 1, active: true })], NOW), [])
  })

  it('leaves alone a journal that cannot be read: it has no date', () => {
    assert.deepEqual(staleJobs([job('broken', { updated: 0, usable: false })], NOW), [])
    assert.deepEqual(staleJobs([job('norecipe', { updated: 1, usable: false })], NOW), [])
  })

  it('takes the time to live as given', () => {
    const list = [job('a', { updated: NOW - 5000 })]
    assert.equal(staleJobs(list, NOW, 4000).length, 1)
    assert.equal(staleJobs(list, NOW, 6000).length, 0)
  })
})

describe('removeStale', () => {
  it('removes the old journals and returns the rest', async () => {
    const removed: string[] = []
    const list = [job('fresh'), job('old1', { updated: 1 }), job('busy', { updated: 1, active: true }), job('old2', { updated: 2 })]
    const rest = await removeStale(list, NOW, async (name) => void removed.push(name))
    assert.deepEqual(removed.sort(), ['old1', 'old2'])
    assert.deepEqual(rest.map((item) => item.job), ['fresh', 'busy'])
  })

  it('removes nothing when nothing is old', async () => {
    const removed: string[] = []
    const rest = await removeStale([job('a'), job('b')], NOW, async (name) => void removed.push(name))
    assert.equal(removed.length, 0)
    assert.equal(rest.length, 2)
  })
})
