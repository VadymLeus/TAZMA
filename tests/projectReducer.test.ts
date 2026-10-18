// tests/projectReducer.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  initialProject,
  projectReducer,
} from '../src/project/projectReducer.ts'
import type { ProjectAction } from '../src/project/projectReducer.ts'
import type { ProjectState, Source } from '../src/project/types.ts'

const source = (id: string, duration: number): Source =>
  ({ id, file: {}, url: `blob:${id}`, info: { duration } }) as unknown as Source

function run(...actions: ProjectAction[]): ProjectState {
  return actions.reduce(projectReducer, initialProject)
}

const add = (id: string, duration: number): ProjectAction => ({
  type: 'addSource',
  source: source(id, duration),
  clipId: `clip-${id}`,
})

describe('projectReducer', () => {
  it('adds a source with a clip that covers the whole file', () => {
    const state = run(add('a', 10))
    assert.equal(state.sources.length, 1)
    assert.deepEqual(state.clips, [
      { id: 'clip-a', sourceId: 'a', start: 0, end: 10 },
    ])
    assert.equal(state.selectedClipId, 'clip-a')
    assert.equal(state.activeSourceId, 'a')
  })

  it('keeps the first file active and selected when more files are added', () => {
    const state = run(add('a', 10), add('b', 5))
    assert.deepEqual(state.sources.map((s) => s.id), ['a', 'b'])
    assert.deepEqual(state.clips.map((c) => c.id), ['clip-a', 'clip-b'])
    assert.equal(state.selectedClipId, 'clip-a')
    assert.equal(state.activeSourceId, 'a')
  })

  it('appends another clip of an existing source', () => {
    const state = run(add('a', 10), { type: 'appendClip', sourceId: 'a', clipId: 'c2' })
    assert.deepEqual(state.clips.map((c) => c.id), ['clip-a', 'c2'])
    assert.equal(state.selectedClipId, 'c2')
  })

  it('ignores appending an unknown source', () => {
    const before = run(add('a', 10))
    assert.equal(
      projectReducer(before, { type: 'appendClip', sourceId: 'zzz', clipId: 'x' }),
      before,
    )
  })

  it('splits at the playhead and selects the right part', () => {
    const state = run(add('a', 10), { type: 'split', time: 4, newId: 'r' })
    assert.deepEqual(
      state.clips.map((c) => [c.id, c.start, c.end]),
      [
        ['clip-a', 0, 4],
        ['r', 4, 10],
      ],
    )
    assert.equal(state.selectedClipId, 'r')
  })

  it('keeps the state when a split is not possible', () => {
    const before = run(add('a', 10))
    assert.equal(projectReducer(before, { type: 'split', time: 0, newId: 'r' }), before)
  })

  it('deletes the selected clip', () => {
    const state = run(
      add('a', 10),
      add('b', 5),
      { type: 'selectClip', clipId: 'clip-b' },
      { type: 'deleteSelected' },
    )
    assert.deepEqual(state.clips.map((c) => c.id), ['clip-a'])
    assert.equal(state.selectedClipId, null)
  })

  it('moves the selected clip', () => {
    const state = run(
      add('a', 10),
      add('b', 5),
      { type: 'selectClip', clipId: 'clip-b' },
      { type: 'moveSelected', delta: -1 },
    )
    assert.deepEqual(state.clips.map((c) => c.id), ['clip-b', 'clip-a'])
  })

  it('does nothing for delete and move without a selection', () => {
    const state = run(add('a', 10), { type: 'selectClip', clipId: null })
    assert.equal(projectReducer(state, { type: 'deleteSelected' }), state)
    assert.equal(projectReducer(state, { type: 'moveSelected', delta: 1 }), state)
  })

  it('selecting a clip activates its source and keeps the clip list', () => {
    const before = run(add('a', 10), add('b', 5))
    const state = projectReducer(before, { type: 'selectClip', clipId: 'clip-b' })
    assert.equal(state.activeSourceId, 'b')
    assert.equal(state.clips, before.clips)
  })

  it('removes a source together with its clips', () => {
    const state = run(
      add('a', 10),
      add('b', 5),
      { type: 'split', time: 12, newId: 'r' },
      { type: 'removeSource', sourceId: 'b' },
    )
    assert.deepEqual(state.sources.map((s) => s.id), ['a'])
    assert.deepEqual(state.clips.map((c) => c.sourceId), ['a'])
    assert.equal(state.activeSourceId, 'a')
  })

  it('clears the selection when the selected clip disappears', () => {
    const state = run(add('a', 10), { type: 'removeSource', sourceId: 'a' })
    assert.equal(state.selectedClipId, null)
    assert.equal(state.activeSourceId, null)
    assert.deepEqual(state.clips, [])
  })

  it('copies the effect to both parts when a clip is split', () => {
    const state = run(
      add('a', 10),
      { type: 'setEffect', clipId: 'clip-a', effect: { kind: 'grayscale', amount: 0.5 } },
      { type: 'split', time: 4, newId: 'r' },
    )
    assert.deepEqual(state.clips.map((c) => c.effect?.amount), [0.5, 0.5])
  })
})

describe('effects', () => {
  it('sets, clamps and clears the effect of one clip', () => {
    const base = run(add('a', 10), add('b', 5))
    const on = projectReducer(base, {
      type: 'setEffect',
      clipId: 'clip-b',
      effect: { kind: 'grayscale', amount: 9 },
    })
    assert.equal(on.clips[0].effect, undefined)
    assert.equal(on.clips[1].effect?.amount, 1)
    const off = projectReducer(on, { type: 'setEffect', clipId: 'clip-b', effect: null })
    assert.equal('effect' in off.clips[1], false)
  })

  it('ignores an unknown clip', () => {
    const base = run(add('a', 10))
    assert.equal(
      projectReducer(base, { type: 'setEffect', clipId: 'zzz', effect: null }),
      base,
    )
  })
})

describe('texts', () => {
  const withText = () => run(add('a', 10), { type: 'addText', textId: 't1', time: 2 })

  it('adds a caption at the playhead and selects it instead of the clip', () => {
    const state = withText()
    assert.deepEqual(
      state.texts.map((t) => [t.id, t.start, t.end]),
      [['t1', 2, 5]],
    )
    assert.equal(state.selectedTextId, 't1')
    assert.equal(state.selectedClipId, null)
  })

  it('does not add a caption to an empty timeline', () => {
    const state = run({ type: 'addText', textId: 't1', time: 0 })
    assert.equal(state.texts.length, 0)
  })

  it('selecting a clip or a caption switches the selection', () => {
    const state = withText()
    const clip = projectReducer(state, { type: 'selectClip', clipId: 'clip-a' })
    assert.equal(clip.selectedTextId, null)
    assert.equal(clip.selectedClipId, 'clip-a')
    const back = projectReducer(clip, { type: 'selectText', textId: 't1' })
    assert.equal(back.selectedClipId, null)
    assert.equal(back.selectedTextId, 't1')
  })

  it('updates a caption inside the timeline', () => {
    const state = projectReducer(withText(), {
      type: 'updateText',
      textId: 't1',
      patch: { text: 'Hi', end: 99 },
    })
    assert.equal(state.texts[0].text, 'Hi')
    assert.equal(state.texts[0].end, 10)
  })

  it('deletes the selected caption, not a clip', () => {
    const state = projectReducer(withText(), { type: 'deleteSelected' })
    assert.equal(state.texts.length, 0)
    assert.equal(state.clips.length, 1)
    assert.equal(state.selectedTextId, null)
  })

  it('keeps captions in place when clips move or split', () => {
    const state = run(
      add('a', 10),
      add('b', 5),
      { type: 'addText', textId: 't1', time: 1 },
      { type: 'selectClip', clipId: 'clip-b' },
      { type: 'moveSelected', delta: -1 },
      { type: 'split', time: 7, newId: 'r' },
    )
    assert.deepEqual(state.texts.map((t) => [t.start, t.end]), [[1, 4]])
  })

  it('cuts or drops captions when the timeline gets shorter', () => {
    const state = run(
      add('a', 10),
      add('b', 5),
      { type: 'addText', textId: 't1', time: 9 },
      { type: 'addText', textId: 't2', time: 13 },
      { type: 'selectClip', clipId: 'clip-b' },
      { type: 'deleteSelected' },
    )
    assert.deepEqual(state.texts.map((t) => [t.id, t.start, t.end]), [['t1', 9, 10]])
    assert.equal(state.selectedTextId, null)
  })

  it('does the same when a source is removed', () => {
    const state = run(
      add('a', 10),
      add('b', 5),
      { type: 'addText', textId: 't1', time: 12 },
      { type: 'removeSource', sourceId: 'b' },
    )
    assert.equal(state.texts.length, 0)
    assert.equal(state.selectedTextId, null)
  })
})
