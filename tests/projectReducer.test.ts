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
})
