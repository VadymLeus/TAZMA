// tests/recompute.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { frameSize, DEFAULT_FRAME } from '../src/project/frame.ts'
import { recomputeRanges, rangesLength } from '../src/project/recompute.ts'
import type { Clip, Source, TextItem } from '../src/project/types.ts'

const clip = (id: string, start: number, end: number, amount?: number): Clip => ({
  id,
  sourceId: 's',
  start,
  end,
  ...(amount === undefined ? {} : { effect: { kind: 'grayscale' as const, amount } }),
})

const text = (start: number, end: number): TextItem => ({
  id: `t${start}`,
  text: 'x',
  start,
  end,
  x: 0.5,
  y: 0.5,
  size: 0.07,
  color: '#fff',
})

// timeline: 0..4, 4..7, 7..12
const clips = [clip('a', 0, 4), clip('b', 0, 3), clip('c', 0, 5)]

describe('recomputeRanges', () => {
  it('is empty without effects and captions', () => {
    assert.deepEqual(recomputeRanges(clips, []), [])
  })

  it('covers a whole clip that has an effect', () => {
    const list = [clips[0], clip('b', 0, 3, 1), clips[2]]
    assert.deepEqual(recomputeRanges(list, []), [{ start: 4, end: 7 }])
  })

  it('ignores an effect with zero strength', () => {
    const list = [clips[0], clip('b', 0, 3, 0), clips[2]]
    assert.deepEqual(recomputeRanges(list, []), [])
  })

  it('covers the time of a caption, even across clips', () => {
    assert.deepEqual(recomputeRanges(clips, [text(3, 5)]), [{ start: 3, end: 5 }])
  })

  it('merges overlapping and touching spans', () => {
    const list = [clips[0], clip('b', 0, 3, 0.5), clips[2]]
    const merged = recomputeRanges(list, [text(6, 9), text(9, 10), text(1, 2)])
    assert.deepEqual(merged, [
      { start: 1, end: 2 },
      { start: 4, end: 10 },
    ])
    assert.equal(rangesLength(merged), 7)
  })

  it('cuts a caption that runs past the end', () => {
    assert.deepEqual(recomputeRanges(clips, [text(11, 20)]), [{ start: 11, end: 12 }])
  })
})

describe('frameSize', () => {
  const source = (width: number, height: number) =>
    ({ id: 's', info: { video: { width, height } } }) as unknown as Source

  it('follows the first clip', () => {
    assert.deepEqual(frameSize(clips, [source(1920, 1080)]), { width: 1920, height: 1080 })
  })

  it('falls back to 16:9 without clips or video', () => {
    assert.deepEqual(frameSize([], []), DEFAULT_FRAME)
    const audioOnly = { id: 's', info: { video: null } } as unknown as Source
    assert.deepEqual(frameSize(clips, [audioOnly]), DEFAULT_FRAME)
  })
})
