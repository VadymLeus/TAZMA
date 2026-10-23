// tests/flowText.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flowRows } from '../src/export/flowText.ts'
import type { FlowReport } from '../src/pipeline/flowControl.ts'

const report = (patch: Partial<FlowReport> = {}): FlowReport => ({
  mode: 'auto',
  phase: 'steady',
  limit: 3,
  byMemory: 194,
  byThroughput: 3,
  tried: 0,
  kept: 0,
  climbedTo: null,
  trials: [],
  rate: 258.4,
  latencyMs: 8.46,
  probeRate: 262.1,
  firstLatencyMs: null,
  margin: 0.25,
  budgetBytes: 268435456,
  frameBytes: 1382400,
  fixedBytes: 7372800,
  peak: 16,
  floor: 1,
  borrowed: 0,
  waitedMs: 0,
  released: false,
  ...patch,
})

describe('flowRows', () => {
  it('says what was tried when the export had to be run again, and why each try failed', () => {
    const rows = flowRows(null, {
      failed: [
        { attempt: { flow: 'auto', software: false }, error: 'Decoding error. (відео)' },
        { attempt: { flow: 'library', software: false }, error: 'Decoding error. (відео, 2)' },
      ],
      used: { flow: 'library', software: true },
    })
    assert.deepEqual(rows, [
      ['Конвеєр', 'Не вдалося: «Авто», «Бібліотека». Експорт зроблено так: «Бібліотека, програмне декодування»'],
      ['Помилка (Авто)', 'Decoding error. (відео)'],
      ['Помилка (Бібліотека)', 'Decoding error. (відео, 2)'],
    ])
  })

  it('has nothing to say without a limit', () => {
    assert.deepEqual(flowRows(null), [])
    assert.deepEqual(flowRows(undefined), [])
  })

  it('describes the auto limit with both bounds and what was measured', () => {
    assert.deepEqual(flowRows(report()), [
      ['Конвеєр', 'Авто: N = 3 (за пам’яттю 194, за швидкістю 3)'],
      ['Виміряно', 'λ ≈ 258 кадр/с, W₀ ≈ 8,5 мс, запас δ = 25 %'],
      ['У конвеєрі', 'пік 16 кадрів'],
    ])
  })

  it('writes the latency without decimals once it is long', () => {
    const rows = flowRows(report({ latencyMs: 41.7 }))
    assert.equal(rows[1]?.[1], 'λ ≈ 258 кадр/с, W₀ ≈ 42 мс, запас δ = 25 %')
  })

  it('says that W0 was measured a second time, and what the first measurement gave', () => {
    const rows = flowRows(report({ latencyMs: 36.2, firstLatencyMs: 116.2 }))
    assert.equal(
      rows[1]?.[1],
      'λ ≈ 258 кадр/с, W₀ ≈ 36 мс (перший замір 116 мс, виміряно вдруге на прогрітому конвеєрі), запас δ = 25 %',
    )
  })

  it('says so when the export was too short to measure', () => {
    const rows = flowRows(report({ rate: null, latencyMs: null, byThroughput: null }))
    assert.equal(rows[0]?.[1], 'Авто: N = 3 (за пам’яттю 194)')
    assert.equal(rows[1]?.[1], 'експорт був надто коротким для виміру')
  })

  it('says so when the budget does not even cover the encoder pictures and one frame', () => {
    const tight = { budgetBytes: 64 * 1024 * 1024, frameBytes: 12441600, fixedBytes: 66355200, byMemory: 1, limit: 1 }
    const rows = flowRows(report(tight))
    assert.deepEqual(rows[1], [
      'Бюджет',
      '64.0 МБ замало: два кадри кодувальника займають 63.3 МБ, ще кадр – 11.9 МБ',
    ])
    assert.equal(rows[0]?.[1], 'Авто: N = 1 (за пам’яттю 1, за швидкістю 3)')
  })

  it('stays quiet about the budget when one frame fits after the encoder pictures', () => {
    const rows = flowRows(report({ budgetBytes: 128 * 1024 * 1024, frameBytes: 12441600, fixedBytes: 66355200 }))
    assert.ok(rows.every(([label]) => label !== 'Бюджет'))
  })

  it('does not mention the budget in the fixed mode, which ignores it', () => {
    const rows = flowRows(report({ mode: 'fixed', budgetBytes: 1, limit: 4, peak: 4 }))
    assert.ok(rows.every(([label]) => label !== 'Бюджет'))
  })

  it('shows a fixed limit as chosen', () => {
    const rows = flowRows(report({ mode: 'fixed', limit: 4, peak: 4 }))
    assert.deepEqual(rows, [
      ['Конвеєр', 'Вручну: N = 4'],
      ['У конвеєрі', 'пік 4 кадри'],
    ])
  })

  it('mentions borrowed credits and a lifted limit', () => {
    const rows = flowRows(report({ borrowed: 3, released: true }))
    assert.equal(
      rows[rows.length - 1]?.[1],
      'пік 16 кадрів, позичено кредитів: 3, ліміт знято: конвеєр затримував кадри',
    )
  })

  it('says how the limit was looked for, and what rate each limit gave', () => {
    const trials = [
      { limit: 17, rate: 452.4 },
      { limit: 48, rate: 567.1 },
      { limit: 28, rate: 560.2 },
    ]
    const rows = flowRows(report({ tried: 4, kept: 1, climbedTo: 28, trials }))
    assert.deepEqual(rows[2], [
      'Підбір N',
      'знайдено N = 28. Кадр/с при різних N: N = 17: 452; N = 48: 567; N = 28: 560',
    ])
  })

  it('says nothing of it when the limit was never tried higher', () => {
    const rows = flowRows(report())
    assert.ok(rows.every(([label]) => label !== 'Підбір N'))
  })

  it('says so when a higher limit gave no more speed', () => {
    const rows = flowRows(report({ tried: 2, kept: 0, climbedTo: null, trials: [{ limit: 7, rate: 100 }, { limit: 48, rate: 101 }] }))
    assert.equal(rows[2]?.[1], 'вищий N швидкості не додав. Кадр/с при різних N: N = 7: 100; N = 48: 101')
  })
})
