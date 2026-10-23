// tests/journalText.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { journalRows, partsWord, suggestionText } from '../src/export/journalText.ts'
import { suggestSegment } from '../src/resume/recommend.ts'
import type { JournalReport } from '../src/export/types.ts'

const report = (over: Partial<JournalReport> = {}): JournalReport => ({
  job: 'j',
  segments: 4,
  segmentSeconds: 30,
  resumedFrom: 0,
  journalBytes: 5 * 1024 * 1024,
  commits: 4,
  commitMs: 80,
  checkpointMs: 400,
  audioMs: 1500,
  videoMs: 52000,
  assembleMs: 900,
  ...over,
})

describe('partsWord', () => {
  it('declines the word by the count', () => {
    assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 100, 101].map(partsWord), [
      'частина', 'частини', 'частини', 'частин', 'частин', 'частин', 'частин', 'частина', 'частини', 'частин', 'частин', 'частина',
    ])
  })
})

describe('journalRows', () => {
  it('has nothing to say about an export without a journal', () => {
    assert.deepEqual(journalRows(null), [])
    assert.deepEqual(journalRows(undefined), [])
  })

  it('says how the journal is cut and what it holds', () => {
    const rows = journalRows(report())
    assert.equal(rows[0][0], 'Журнал')
    assert.match(rows[0][1], /^4 частини по 30 с, 5/)
  })

  it('gives the mean cost of a checkpoint and the part that is writing', () => {
    const rows = journalRows(report())
    const row = rows.find(([label]) => label === 'Контрольні точки')
    assert.ok(row)
    assert.match(row[1], /4 частини закрито; у середньому 100 мс на точку, з них запис і підтвердження 20 мс/)
  })

  it('counts the opening of the next part in the mean cost and names it', () => {
    const row = journalRows(report({ openMs: 200 })).find(([label]) => label === 'Контрольні точки')
    assert.match(row?.[1] ?? '', /у середньому 150 мс на точку, з них запис і підтвердження 20 мс, відкриття наступної частини 50 мс/)
  })

  it('names the stages and leaves out the sound when it was not done in this run', () => {
    const withSound = journalRows(report()).find(([label]) => label === 'Етапи')
    assert.match(withSound?.[1] ?? '', /^звук 1,5 с, відео 52 с, збирання 0,9 с$/)
    const without = journalRows(report({ audioMs: 0 })).find(([label]) => label === 'Етапи')
    assert.match(without?.[1] ?? '', /^відео 52 с, збирання 0,9 с$/)
  })

  it('says where an export went on from', () => {
    const rows = journalRows(report({ resumedFrom: 60 }))
    assert.deepEqual(rows.find(([label]) => label === 'Відновлення'), ['Відновлення', 'експорт продовжено з 60 с таймлайну'])
    assert.equal(journalRows(report()).some(([label]) => label === 'Відновлення'), false)
  })

  it('leaves out the checkpoint row when no part was closed', () => {
    assert.equal(journalRows(report({ commits: 0 })).some(([label]) => label === 'Контрольні точки'), false)
  })
})

describe('journalRows with the duration', () => {
  it('adds the part length the formula would give, and what both cost', () => {
    const rows = journalRows(report(), 120)
    const row = rows.find(([label]) => label === 'Довжина частини')
    assert.ok(row)
    assert.match(row[1], /τ = √\(2·t_c·M\)/)
    assert.match(row[1], /M = 60 хв/)
    assert.match(row[1], /≈ \d+,\d %/)
  })

  it('says nothing about it without a duration or without a closed part', () => {
    assert.equal(journalRows(report()).some(([label]) => label === 'Довжина частини'), false)
    assert.equal(journalRows(report({ commits: 0 }), 120).some(([label]) => label === 'Довжина частини'), false)
  })
})

describe('suggestionText', () => {
  it('says the numbers come from the defaults until something was measured', () => {
    const found = suggestSegment(60, null)
    assert.ok(found)
    assert.match(suggestionText(found), /типові значення/)
  })

  it('says the numbers were measured here, with the length and the loss', () => {
    const found = suggestSegment(60, { cost: 0.044, speed: 3 })
    assert.ok(found)
    const text = suggestionText(found)
    assert.match(text, /t_c = 44 мс/)
    assert.match(text, /виміряно в цьому браузері/)
    assert.match(text, new RegExp(`${found.plan.segment} с таймлайну`))
    assert.match(text, /≈ \d+,\d %/)
  })
})
