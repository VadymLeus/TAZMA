// tests/jobText.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JobSummary } from '../src/resume/jobs.ts'
import { coveredPercent, progressLine, remainderLine } from '../src/resume/jobText.ts'

const job = (over: Partial<JobSummary> = {}): JobSummary => ({
  job: 'j',
  created: 1,
  updated: 2,
  total: 200,
  covered: 60,
  segments: 2,
  bytes: 2048,
  audio: 'done',
  complete: false,
  sources: [],
  active: false,
  usable: true,
  problems: [],
  ...over,
})

describe('coveredPercent', () => {
  it('rounds the share of the timeline the journal covers', () => {
    assert.equal(coveredPercent(job()), 30)
    assert.equal(coveredPercent(job({ covered: 199 })), 100)
  })

  it('stays within 0 to 100 and survives an empty project', () => {
    assert.equal(coveredPercent(job({ total: 0 })), 0)
    assert.equal(coveredPercent(job({ covered: 500 })), 100)
    assert.equal(coveredPercent(job({ covered: -1 })), 0)
  })
})

describe('progressLine', () => {
  it('gives the covered time, the parts and the size', () => {
    const line = progressLine(job())
    assert.match(line, /30 %/)
    assert.match(line, /2 частини/)
    assert.match(line, /2\.0 КБ/)
  })
})

describe('remainderLine', () => {
  it('says what is left', () => {
    assert.match(remainderLine(job()), /Звук закодовано\. Решту відео буде закодовано\./)
    assert.match(remainderLine(job({ audio: 'pending' })), /Звук ще не закодовано/)
    assert.match(remainderLine(job({ audio: 'none' })), /Звуку немає/)
    assert.match(remainderLine(job({ complete: true })), /лишилось зібрати файл/)
  })
})
