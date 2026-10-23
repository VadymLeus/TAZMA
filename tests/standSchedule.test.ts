// tests/standSchedule.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeSchedule, mulberry32 } from '../src/stand/schedule.ts'

const ids = ['a', 'b', 'c', 'd']

describe('mulberry32', () => {
  it('gives the same numbers for the same seed, and numbers in [0, 1)', () => {
    const one = mulberry32(7)
    const two = mulberry32(7)
    for (let i = 0; i < 50; i++) {
      const value = one()
      assert.equal(value, two())
      assert.ok(value >= 0 && value < 1)
    }
    assert.notEqual(mulberry32(1)(), mulberry32(2)())
  })
})

describe('makeSchedule', () => {
  it('runs every condition once in every round', () => {
    const runs = makeSchedule({ conditions: ids, repeats: 5, seed: 3 })
    assert.equal(runs.length, 20)
    for (let round = 0; round < 5; round++) {
      const names = runs.filter((run) => run.round === round).map((run) => run.condition).sort()
      assert.deepEqual(names, ids)
    }
    assert.deepEqual(runs.map((run) => run.index), runs.map((_, index) => index))
    assert.ok(runs.every((run) => !run.warmup))
  })

  it('is the same for the same seed and different for another', () => {
    const order = (seed: number) => makeSchedule({ conditions: ids, repeats: 6, seed }).map((run) => run.condition).join('')
    assert.equal(order(11), order(11))
    assert.notEqual(order(11), order(12))
  })

  it('never puts the same condition twice in a row', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const list of [['a', 'b'], ['a', 'b', 'c']]) {
        const runs = makeSchedule({ conditions: list, repeats: 8, seed, warmupRuns: 2 })
        for (let i = 1; i < runs.length; i++) assert.notEqual(runs[i].condition, runs[i - 1].condition)
      }
    }
  })

  it('does not always put a condition in the same place of the round', () => {
    const runs = makeSchedule({ conditions: ids, repeats: 40, seed: 5 })
    const firsts = new Set(runs.filter((run, index) => index % ids.length === 0).map((run) => run.condition))
    assert.ok(firsts.size > 1)
  })

  it('puts the warm-up runs first and marks them', () => {
    const runs = makeSchedule({ conditions: ids, repeats: 2, seed: 1, warmupRuns: 6 })
    assert.equal(runs.length, 6 + 8)
    assert.ok(runs.slice(0, 6).every((run) => run.warmup && run.round === -1))
    assert.ok(runs.slice(6).every((run) => !run.warmup && run.round >= 0))
  })

  it('works with one condition', () => {
    const runs = makeSchedule({ conditions: ['only'], repeats: 3, seed: 1 })
    assert.deepEqual(runs.map((run) => run.condition), ['only', 'only', 'only'])
  })

  it('refuses what cannot be scheduled', () => {
    assert.throws(() => makeSchedule({ conditions: [], repeats: 1, seed: 1 }), RangeError)
    assert.throws(() => makeSchedule({ conditions: ['a', 'a'], repeats: 1, seed: 1 }), RangeError)
    assert.throws(() => makeSchedule({ conditions: ids, repeats: 0, seed: 1 }), RangeError)
    assert.throws(() => makeSchedule({ conditions: ids, repeats: 1.5, seed: 1 }), RangeError)
    assert.throws(() => makeSchedule({ conditions: ids, repeats: 1, seed: 1, warmupRuns: -1 }), RangeError)
  })
})
