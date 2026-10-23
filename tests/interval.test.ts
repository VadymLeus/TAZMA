// tests/interval.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  optimalInterval,
  parseMinutes,
  parseSegmentSeconds,
  planInterval,
  wasteRate,
} from '../src/resume/interval.ts'

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not ${expected}`)

describe('optimalInterval', () => {
  it('is √(2·t_c·M)', () => {
    near(optimalInterval(0.06, 3600), Math.sqrt(432))
    near(optimalInterval(2, 25), 10)
  })

  it('grows with the cost of a checkpoint and with the time between cuts', () => {
    assert.ok(optimalInterval(0.1, 3600) > optimalInterval(0.05, 3600))
    assert.ok(optimalInterval(0.05, 7200) > optimalInterval(0.05, 3600))
  })

  it('refuses numbers that are not positive', () => {
    for (const [cost, mtbf] of [[0, 10], [-1, 10], [1, 0], [Number.NaN, 10], [1, Infinity]]) {
      assert.throws(() => optimalInterval(cost, mtbf), RangeError)
    }
  })
})

describe('wasteRate', () => {
  it('is t_c/τ + τ/(2M)', () => {
    near(wasteRate(0.06, 20, 3600), 0.06 / 20 + 20 / 7200)
  })

  it('is least at the optimal interval, where it equals √(2·t_c/M)', () => {
    const cost = 0.06
    const mtbf = 3600
    const best = optimalInterval(cost, mtbf)
    near(wasteRate(cost, best, mtbf), Math.sqrt((2 * cost) / mtbf))
    assert.ok(wasteRate(cost, best, mtbf) < wasteRate(cost, best * 0.5, mtbf))
    assert.ok(wasteRate(cost, best, mtbf) < wasteRate(cost, best * 2, mtbf))
    assert.ok(wasteRate(cost, best, mtbf) < wasteRate(cost, best * 0.9, mtbf))
    assert.ok(wasteRate(cost, best, mtbf) < wasteRate(cost, best * 1.1, mtbf))
  })
})

describe('planInterval', () => {
  it('turns seconds of work into seconds of timeline by the speed', () => {
    const plan = planInterval({ cost: 0.06, mtbf: 3600, speed: 2 })
    near(plan.work, Math.sqrt(432))
    assert.equal(plan.segment, Math.round(Math.sqrt(432) * 2))
    assert.equal(plan.clamped, false)
    assert.ok(plan.waste > 0 && plan.waste < 0.02)
  })

  it('keeps the part within the limits and says so', () => {
    const short = planInterval({ cost: 0.001, mtbf: 10, speed: 1 })
    assert.equal(short.segment, MIN_SEGMENT_SECONDS)
    assert.equal(short.clamped, true)
    const long = planInterval({ cost: 5, mtbf: 86400, speed: 50 })
    assert.equal(long.segment, MAX_SEGMENT_SECONDS)
    assert.equal(long.clamped, true)
  })

  it('gives a whole number of seconds', () => {
    const plan = planInterval({ cost: 0.043, mtbf: 1800, speed: 3.7 })
    assert.equal(plan.segment, Math.round(plan.segment))
  })

  it('refuses a speed that is not positive', () => {
    assert.throws(() => planInterval({ cost: 0.06, mtbf: 3600, speed: 0 }), RangeError)
  })
})

describe('what the person types', () => {
  it('takes a length of a part within the limits, with a comma or a point', () => {
    assert.equal(parseSegmentSeconds('30'), 30)
    assert.equal(parseSegmentSeconds(' 12,5 '), 12.5)
    assert.equal(parseSegmentSeconds(String(MIN_SEGMENT_SECONDS)), MIN_SEGMENT_SECONDS)
    assert.equal(parseSegmentSeconds(String(MAX_SEGMENT_SECONDS)), MAX_SEGMENT_SECONDS)
  })

  it('refuses a length that is empty, not a number or outside the limits', () => {
    for (const text of ['', ' ', 'abc', '1', '601', '-5', 'Infinity', '1e999']) {
      assert.equal(parseSegmentSeconds(text), null, text)
    }
  })

  it('takes a time between cuts that is positive', () => {
    assert.equal(parseMinutes('60'), 60)
    assert.equal(parseMinutes('0,5'), 0.5)
    for (const text of ['', '0', '-1', 'x', '1e9']) assert.equal(parseMinutes(text), null, text)
  })
})
