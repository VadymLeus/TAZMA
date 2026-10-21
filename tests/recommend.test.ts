// tests/recommend.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JournalReport } from '../src/export/types.ts'
import { DEFAULT_COST, DEFAULT_SPEED, optimalInterval, wasteRate } from '../src/resume/interval.ts'
import { recommendationOf, suggestSegment } from '../src/resume/recommend.ts'

const report = (over: Partial<JournalReport> = {}): JournalReport => ({
  job: 'j',
  segments: 4,
  segmentSeconds: 30,
  resumedFrom: 0,
  journalBytes: 1000,
  commits: 4,
  commitMs: 100,
  checkpointMs: 240,
  audioMs: 50,
  videoMs: 30000,
  assembleMs: 500,
  ...over,
})

describe('suggestSegment', () => {
  it('uses the defaults until something has been measured', () => {
    const found = suggestSegment(60, null)
    assert.ok(found)
    assert.equal(found.measured, false)
    assert.equal(found.cost, DEFAULT_COST)
    assert.equal(found.speed, DEFAULT_SPEED)
    assert.equal(found.plan.segment, Math.round(optimalInterval(DEFAULT_COST, 3600) * DEFAULT_SPEED))
  })

  it('uses the measurement when there is one', () => {
    const found = suggestSegment(30, { cost: 0.1, speed: 5 })
    assert.ok(found)
    assert.equal(found.measured, true)
    assert.equal(found.mtbfMinutes, 30)
    assert.equal(found.plan.segment, Math.round(optimalInterval(0.1, 1800) * 5))
  })

  it('gives longer parts for a longer time between cuts', () => {
    const short = suggestSegment(10, { cost: 0.06, speed: 2 })
    const long = suggestSegment(240, { cost: 0.06, speed: 2 })
    assert.ok(short && long && long.plan.segment > short.plan.segment)
  })

  it('refuses a time between cuts that is not a positive number', () => {
    for (const value of [0, -5, Number.NaN, Infinity]) assert.equal(suggestSegment(value, null), null)
  })
})

describe('recommendationOf', () => {
  it('works out what the part length of the export cost against the best one', () => {
    const found = recommendationOf(report(), 120, 60)
    assert.ok(found)
    assert.equal(found.cost, 0.06)
    assert.equal(found.speed, 4)
    assert.equal(found.usedWaste, wasteRate(0.06, 30 / 4, 3600))
    assert.ok(found.plan.waste <= found.usedWaste)
  })

  it('has nothing to say when no part was closed or no video was made', () => {
    assert.equal(recommendationOf(report({ commits: 0 }), 120), null)
    assert.equal(recommendationOf(report({ videoMs: 0 }), 120), null)
  })
})
