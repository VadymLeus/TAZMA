// tests/texts.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_SIZE,
  MIN_SIZE,
  MIN_TEXT,
  assignLanes,
  fitTexts,
  newText,
  normalizeText,
  textsAt,
  updateText,
} from '../src/project/texts.ts'
import type { TextItem } from '../src/project/types.ts'

const text = (id: string, start: number, end: number): TextItem => ({
  id,
  text: id,
  start,
  end,
  x: 0.5,
  y: 0.85,
  size: 0.07,
  color: '#ffffff',
})

describe('newText', () => {
  it('starts at the playhead and lasts three seconds', () => {
    const item = newText('t', 2, 10)
    assert.equal(item?.start, 2)
    assert.equal(item?.end, 5)
  })

  it('is cut at the end of the timeline', () => {
    const item = newText('t', 9, 10)
    assert.equal(item?.start, 9)
    assert.equal(item?.end, 10)
  })

  it('moves back when the playhead is at the very end', () => {
    const item = newText('t', 10, 10)
    assert.ok(item)
    assert.ok(item.start < 10 && item.end === 10)
    assert.ok(item.end - item.start >= MIN_TEXT - 1e-9)
  })

  it('refuses an empty timeline', () => {
    assert.equal(newText('t', 0, 0), null)
  })
})

describe('normalizeText', () => {
  it('keeps the caption inside the timeline', () => {
    const item = normalizeText(text('a', -3, 99), 10)
    assert.equal(item.start, 0)
    assert.equal(item.end, 10)
  })

  it('keeps a minimal length and clamps the rest', () => {
    const item = normalizeText({ ...text('a', 4, 4), x: 3, y: -1, size: 5 }, 10)
    assert.ok(item.end - item.start >= MIN_TEXT - 1e-9)
    assert.equal(item.x, 1)
    assert.equal(item.y, 0)
    assert.equal(item.size, MAX_SIZE)
    assert.equal(normalizeText({ ...text('a', 1, 2), size: 0 }, 10).size, MIN_SIZE)
  })

  it('falls back to defaults for NaN', () => {
    const item = normalizeText({ ...text('a', Number.NaN, Number.NaN), x: Number.NaN }, 10)
    assert.equal(item.start, 0)
    assert.equal(item.end, 10)
    assert.equal(item.x, 0.5)
  })
})

describe('updateText', () => {
  it('changes only the chosen caption', () => {
    const list = [text('a', 0, 2), text('b', 3, 5)]
    const next = updateText(list, 'b', { text: 'new', start: 4 }, 10)
    assert.equal(next[0], list[0])
    assert.equal(next[1].text, 'new')
    assert.equal(next[1].start, 4)
  })

  it('moves the end after a start that passes it', () => {
    const next = updateText([text('a', 1, 2)], 'a', { start: 6 }, 10)
    assert.equal(next[0].start, 6)
    assert.ok(next[0].end > 6)
  })
})

describe('textsAt', () => {
  const list = [text('a', 1, 3), text('b', 2, 4)]

  it('returns captions active at the time, end exclusive', () => {
    assert.deepEqual(textsAt(list, 0.5).map((t) => t.id), [])
    assert.deepEqual(textsAt(list, 1).map((t) => t.id), ['a'])
    assert.deepEqual(textsAt(list, 2.5).map((t) => t.id), ['a', 'b'])
    assert.deepEqual(textsAt(list, 3).map((t) => t.id), ['b'])
    assert.deepEqual(textsAt(list, 4).map((t) => t.id), [])
  })
})

describe('fitTexts', () => {
  it('cuts captions at the new end and drops those past it', () => {
    const list = [text('a', 0, 3), text('b', 4, 8), text('c', 9, 10)]
    const fitted = fitTexts(list, 6)
    assert.deepEqual(
      fitted.map((t) => [t.id, t.start, t.end]),
      [
        ['a', 0, 3],
        ['b', 4, 6],
      ],
    )
    assert.equal(fitted[0], list[0])
  })

  it('returns the same array when nothing changes', () => {
    const list = [text('a', 0, 3)]
    assert.equal(fitTexts(list, 10), list)
  })

  it('drops everything when the timeline is empty', () => {
    assert.deepEqual(fitTexts([text('a', 0, 3)], 0), [])
  })
})

describe('assignLanes', () => {
  it('uses one lane when captions do not overlap', () => {
    const result = assignLanes([text('a', 0, 2), text('b', 2, 4)])
    assert.equal(result.count, 1)
    assert.equal(result.lane.get('b'), 0)
  })

  it('moves overlapping captions to another lane and reuses free ones', () => {
    const result = assignLanes([text('a', 0, 5), text('b', 1, 3), text('c', 3, 6)])
    assert.equal(result.count, 2)
    assert.deepEqual(
      ['a', 'b', 'c'].map((id) => result.lane.get(id)),
      [0, 1, 1],
    )
  })

  it('has one empty lane without captions', () => {
    assert.equal(assignLanes([]).count, 1)
  })
})
