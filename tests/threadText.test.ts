// tests/threadText.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { threadRows } from '../src/export/threadText.ts'

describe('threadRows', () => {
  it('has nothing to say when the export did not tell where it ran', () => {
    assert.deepEqual(threadRows(undefined, null), [])
  })

  it('says the export ran in a worker and the page did not freeze', () => {
    assert.deepEqual(threadRows('worker', { longTasks: 0, longestMs: 0, totalMs: 0, maxGapMs: 18 }), [
      ['Потік', 'Окремий потік (Web Worker)'],
      ['Інтерфейс', 'найдовша затримка відповіді 18 мс; довгих пауз немає'],
    ])
  })

  it('counts the freezes of a page that did the export itself', () => {
    assert.deepEqual(threadRows('main', { longTasks: 12, longestMs: 180, totalMs: 900, maxGapMs: 190 }), [
      ['Потік', 'Основний потік сторінки'],
      ['Інтерфейс', 'найдовша затримка відповіді 190 мс; довгих пауз: 12, найдовша 180 мс, разом 900 мс'],
    ])
  })

  it('leaves out the delay when there was no heartbeat to measure it', () => {
    assert.deepEqual(threadRows('main', { longTasks: 0, longestMs: 0, totalMs: 0, maxGapMs: null }), [
      ['Потік', 'Основний потік сторінки'],
      ['Інтерфейс', 'довгих пауз немає'],
    ])
  })

  it('says so when the memory of the worker cannot be read', () => {
    assert.deepEqual(threadRows('worker', null, true), [
      ['Потік', 'Окремий потік (Web Worker)'],
      ['Купа JavaScript', 'у фоновому потоці браузер її не показує'],
    ])
  })

  it('leaves out the page when the browser does not report freezes', () => {
    assert.deepEqual(threadRows('worker', null), [['Потік', 'Окремий потік (Web Worker)']])
  })
})
