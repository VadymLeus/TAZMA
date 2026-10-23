// tests/measure.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JournalReport } from '../src/export/types.ts'
import { loadMeasurement, measurementOf, saveMeasurement } from '../src/resume/measure.ts'
import type { StorageLike } from '../src/resume/measure.ts'

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

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

describe('measurementOf', () => {
  it('takes the cost of a checkpoint and the speed of the video work', () => {
    const found = measurementOf(report(), 120)
    assert.ok(found)
    assert.equal(found.cost, 0.06)
    assert.equal(found.speed, 4)
  })

  it('adds the time to open the next part to the cost of a checkpoint', () => {
    const found = measurementOf(report({ openMs: 120 }), 120)
    assert.ok(found)
    assert.ok(Math.abs(found.cost - 0.09) < 1e-12)
  })

  it('counts only the timeline this run covered', () => {
    const found = measurementOf(report({ resumedFrom: 60 }), 120)
    assert.equal(found?.speed, 2)
  })

  it('gives nothing when no part was closed or no video was made', () => {
    assert.equal(measurementOf(report({ commits: 0 }), 120), null)
    assert.equal(measurementOf(report({ videoMs: 0 }), 120), null)
    assert.equal(measurementOf(report({ resumedFrom: 120 }), 120), null)
  })
})

describe('the saved measurement', () => {
  it('comes back for the mode it was saved for', () => {
    const storage = memoryStorage()
    saveMeasurement('full', { cost: 0.05, speed: 2 }, storage)
    saveMeasurement('selective', { cost: 0.02, speed: 20 }, storage)
    assert.deepEqual(loadMeasurement('full', storage), { cost: 0.05, speed: 2 })
    assert.deepEqual(loadMeasurement('selective', storage), { cost: 0.02, speed: 20 })
  })

  it('is replaced by a newer one of the same mode only', () => {
    const storage = memoryStorage()
    saveMeasurement('full', { cost: 0.05, speed: 2 }, storage)
    saveMeasurement('selective', { cost: 0.02, speed: 20 }, storage)
    saveMeasurement('full', { cost: 0.07, speed: 3 }, storage)
    assert.deepEqual(loadMeasurement('full', storage), { cost: 0.07, speed: 3 })
    assert.deepEqual(loadMeasurement('selective', storage), { cost: 0.02, speed: 20 })
  })

  it('is nothing when the storage is missing, empty, damaged or blocked', () => {
    assert.equal(loadMeasurement('full', null), null)
    assert.equal(loadMeasurement('full', memoryStorage()), null)
    const damaged = memoryStorage()
    damaged.data.set('tazma.checkpoints.v1', '{not json')
    assert.equal(loadMeasurement('full', damaged), null)
    const wrong = memoryStorage()
    wrong.data.set('tazma.checkpoints.v1', JSON.stringify({ full: { cost: -1, speed: 'fast' } }))
    assert.equal(loadMeasurement('full', wrong), null)
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    assert.equal(loadMeasurement('full', blocked), null)
    assert.doesNotThrow(() => saveMeasurement('full', { cost: 1, speed: 1 }, blocked))
  })
})
