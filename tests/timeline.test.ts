// tests/timeline.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canSplit,
  clipStart,
  locate,
  moveClip,
  playbackStep,
  removeClip,
  removeSourceClips,
  splitAt,
  timelineDuration,
} from '../src/project/timeline.ts'
import type { Clip } from '../src/project/types.ts'

const clip = (id: string, sourceId: string, start: number, end: number): Clip => ({
  id,
  sourceId,
  start,
  end,
})

// timeline: A 0..4 -> 0..4, B 10..13 -> 4..7
const clips = [clip('a', 's1', 0, 4), clip('b', 's2', 10, 13)]

describe('locate', () => {
  it('finds the clip and the offset inside it', () => {
    assert.deepEqual(locate(clips, 1.5), { index: 0, offset: 1.5 })
    assert.deepEqual(locate(clips, 5), { index: 1, offset: 1 })
  })

  it('puts a boundary into the next clip', () => {
    assert.deepEqual(locate(clips, 4), { index: 1, offset: 0 })
  })

  it('clamps to the ends of the timeline', () => {
    assert.deepEqual(locate(clips, -3), { index: 0, offset: 0 })
    assert.deepEqual(locate(clips, 99), { index: 1, offset: 3 })
  })

  it('returns null for an empty timeline', () => {
    assert.equal(locate([], 1), null)
  })
})

describe('durations', () => {
  it('sums clip lengths and finds clip starts', () => {
    assert.equal(timelineDuration(clips), 7)
    assert.equal(clipStart(clips, 0), 0)
    assert.equal(clipStart(clips, 1), 4)
  })
})

describe('splitAt', () => {
  it('splits inside a clip without losing or duplicating time', () => {
    const result = splitAt(clips, 5, 'new')
    assert.ok(result)
    assert.deepEqual(result.clips.map((c) => c.id), ['a', 'b', 'new'])
    assert.deepEqual(result.clips[1], clip('b', 's2', 10, 11))
    assert.deepEqual(result.clips[2], clip('new', 's2', 11, 13))
    assert.equal(timelineDuration(result.clips), 7)
    assert.equal(result.rightId, 'new')
  })

  it('does not split on a boundary or too close to one', () => {
    assert.equal(splitAt(clips, 4, 'x'), null)
    assert.equal(splitAt(clips, 0, 'x'), null)
    assert.equal(splitAt(clips, 7, 'x'), null)
    assert.equal(splitAt(clips, 4.02, 'x'), null)
    assert.equal(canSplit(clips, 4.02), false)
    assert.equal(canSplit(clips, 4.5), true)
  })

  it('does not change the input', () => {
    const before = JSON.stringify(clips)
    splitAt(clips, 2, 'x')
    assert.equal(JSON.stringify(clips), before)
  })
})

describe('edits', () => {
  it('removes a clip and shifts the rest', () => {
    const rest = removeClip(clips, 'a')
    assert.deepEqual(rest.map((c) => c.id), ['b'])
    assert.equal(clipStart(rest, 0), 0)
  })

  it('removes all clips of a source', () => {
    const three = [...clips, clip('c', 's1', 5, 6)]
    assert.deepEqual(removeSourceClips(three, 's1').map((c) => c.id), ['b'])
  })

  it('moves a clip by one place and ignores moves past the ends', () => {
    assert.deepEqual(moveClip(clips, 'a', 1).map((c) => c.id), ['b', 'a'])
    assert.equal(moveClip(clips, 'a', -1), clips)
    assert.equal(moveClip(clips, 'b', 1), clips)
    assert.equal(moveClip(clips, 'missing', 1), clips)
  })
})

describe('playbackStep', () => {
  it('reports the playhead inside a clip', () => {
    assert.deepEqual(playbackStep(clips, 1, 11), { kind: 'play', playhead: 5 })
  })

  it('advances to the next clip at the end of a clip', () => {
    assert.deepEqual(playbackStep(clips, 0, 4), {
      kind: 'advance',
      index: 1,
      contiguous: false,
    })
  })

  it('treats the two halves of a split as contiguous', () => {
    const split = splitAt(clips, 2, 'n')
    assert.ok(split)
    assert.deepEqual(playbackStep(split.clips, 0, 2), {
      kind: 'advance',
      index: 1,
      contiguous: true,
    })
  })

  it('ends after the last clip', () => {
    assert.deepEqual(playbackStep(clips, 1, 13), { kind: 'end' })
  })
})
