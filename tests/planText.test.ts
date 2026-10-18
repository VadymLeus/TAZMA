// tests/planText.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { blockerLines, planSentence, statsSentence } from '../src/export/planText.ts'
import type { SourceStream, TargetStream } from '../src/export/selectivePlan.ts'

const summary = (copy: number, byReason: Partial<Record<string, number>>) => {
  const full = { effect: 0, text: 0, edge: 0, short: 0, source: 0, ...byReason }
  return {
    copySeconds: copy,
    recodeSeconds: Object.values(full).reduce((a, b) => a + b, 0),
    byReason: full,
  }
}

describe('planSentence', () => {
  it('names the causes of recoding that exist', () => {
    const text = planSentence(summary(38, { text: 1.2, edge: 0.8 }))
    assert.equal(text, 'Копіюється 38,0 с з 40,0 с (95 %). Перераховується 2,0 с: написи 1,2 с · межі GOP 0,8 с.')
  })

  it('says so when nothing is recoded', () => {
    assert.match(planSentence(summary(12, {})), /Перераховувати нічого не треба/)
  })

  it('handles an empty plan', () => {
    assert.equal(planSentence(summary(0, {})), 'Немає що експортувати.')
  })
})

describe('blockerLines', () => {
  const target: TargetStream = {
    codec: 'avc',
    codecString: 'avc1.640028',
    description: Uint8Array.of(1, 2, 3),
    width: 1280,
    height: 720,
    color: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
  }
  const source: SourceStream = {
    codec: 'avc',
    codecString: 'avc1.64001f',
    description: Uint8Array.of(9, 9),
    width: 1280,
    height: 720,
    rotation: 0,
    color: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  }

  it('lists only the sources that cannot be copied', () => {
    const lines = blockerLines(
      [['a', []], ['b', ['size']], ['c', ['params']]],
      (id) => `${id}.webm`,
      () => ({ ...source, width: 640 }),
      target,
    )
    assert.deepEqual(
      lines.map((line) => line.headline),
      ['b.webm: розмір кадру відрізняється від результату', 'c.webm: параметри потоку не збігаються з кодувальником'],
    )
  })

  it('shows the values behind every reason', () => {
    const [line] = blockerLines([['a', ['color', 'params']]], () => 'a.mp4', () => source, target)
    assert.equal(line?.headline, 'a.mp4: інший колірний простір')
    assert.deepEqual(line?.details, [
      'колірний простір: файл bt709 / bt709 / bt709, діапазон обмежений; кодувальник bt709 / iec61966-2-1 / rgb, діапазон повний',
      'опис H.264: файл avc1.64001f, кодувальник avc1.640028; опис файлу не розібрано або не підтримується',
    ])
  })

  it('says when the source states no colour', () => {
    const [line] = blockerLines([['a', ['color']]], () => 'a.mp4', () => ({ ...source, color: null }), target)
    assert.match(line?.details[0] ?? '', /файл не вказано/)
  })
})

describe('statsSentence', () => {
  const base = { copiedSeconds: 0, recodedSeconds: 0, runs: 0, rewrittenPackets: 0 }
  it('reports the copied share', () => {
    const text = statsSentence({ ...base, mode: 'selective', framesCopied: 1140, framesRecoded: 60, fallbackGops: 0 })
    assert.equal(text, 'Скопійовано 1140 з 1200 кадрів (95 %), перераховано 60')
  })

  it('mentions open GOPs', () => {
    const text = statsSentence({ ...base, mode: 'selective', framesCopied: 10, framesRecoded: 10, fallbackGops: 2 })
    assert.match(text, /2 GOP із відкритою структурою/)
  })

  it('reports a full export', () => {
    assert.equal(
      statsSentence({ ...base, mode: 'full', framesCopied: 0, framesRecoded: 240, fallbackGops: 0 }),
      'Усі 240 кадрів перераховано',
    )
  })
})
