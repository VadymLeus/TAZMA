// tests/fingerprint.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ExportProject, ExportSettings } from '../src/export/types.ts'
import { fingerprintOf } from '../src/resume/fingerprint.ts'
import { makeRecipe, sourceRefs } from '../src/resume/manifest.ts'

const file = (name: string, size: number, lastModified: number) => ({ name, size, lastModified }) as File

const project = (): ExportProject => ({
  clips: [
    { id: 'c1', sourceId: 's1', start: 0, end: 10 },
    { id: 'c2', sourceId: 's2', start: 5, end: 9, effect: { kind: 'grayscale', amount: 1 } },
  ],
  texts: [{ id: 't1', text: 'Hi', start: 1, end: 3, x: 0.5, y: 0.5, size: 0.1, color: '#fff' }],
  sources: [
    { id: 's1', file: file('a.mp4', 1000, 111), url: 'blob:1', info: {} as never },
    { id: 's2', file: file('b.webm', 2000, 222), url: 'blob:2', info: {} as never },
  ],
})

const settings = (): ExportSettings => ({
  mode: 'selective',
  container: 'mp4',
  videoCodec: 'avc',
  audioCodec: 'aac',
  quality: 'medium',
  height: null,
  ignoreColor: false,
  gifFps: 15,
  gifDither: true,
  gifLoop: true,
  flow: 'auto',
  flowLimit: 8,
  memoryBudget: 256,
  recordMemory: false,
})

describe('fingerprint', () => {
  it('is the same for the same export, and 64 hex digits long', async () => {
    const a = await fingerprintOf(project(), settings())
    const b = await fingerprintOf(project(), settings())
    assert.equal(a, b)
    assert.match(a, /^[0-9a-f]{64}$/)
  })

  it('does not depend on the blob address of a source, which is new on every page', async () => {
    const other = project()
    other.sources[0]!.url = 'blob:somewhere-else'
    assert.equal(await fingerprintOf(other, settings()), await fingerprintOf(project(), settings()))
  })

  it('changes with any edit of the project', async () => {
    const base = await fingerprintOf(project(), settings())
    const edits: ((p: ExportProject) => void)[] = [
      (p) => (p.clips[0]!.end = 10.5),
      (p) => (p.clips[0]!.start = 0.5),
      (p) => (p.clips[1]!.effect = undefined),
      (p) => (p.clips[1]!.effect = { kind: 'grayscale', amount: 0.5 }),
      (p) => p.clips.reverse(),
      (p) => (p.texts[0]!.text = 'Ho'),
      (p) => (p.texts[0]!.start = 1.5),
      (p) => p.texts.pop(),
    ]
    for (const [index, edit] of edits.entries()) {
      const edited = project()
      edit(edited)
      assert.notEqual(await fingerprintOf(edited, settings()), base, `edit ${index}`)
    }
  })

  it('changes when a source file is another file: name, size or date', async () => {
    const base = await fingerprintOf(project(), settings())
    for (const make of [
      () => file('c.mp4', 1000, 111),
      () => file('a.mp4', 1001, 111),
      () => file('a.mp4', 1000, 112),
    ]) {
      const edited = project()
      edited.sources[0]!.file = make()
      assert.notEqual(await fingerprintOf(edited, settings()), base)
    }
  })

  it('changes with the settings that shape the output', async () => {
    const base = await fingerprintOf(project(), settings())
    const edits: Partial<ExportSettings>[] = [
      { mode: 'full' },
      { container: 'webm' },
      { videoCodec: 'vp9' },
      { audioCodec: 'opus' },
      { quality: 'high' },
      { height: 720 },
      { ignoreColor: true },
    ]
    for (const edit of edits) {
      assert.notEqual(await fingerprintOf(project(), { ...settings(), ...edit }), base, JSON.stringify(edit))
    }
  })

  it('does not change with the settings that leave the output as it is', async () => {
    const base = await fingerprintOf(project(), settings())
    const edits: Partial<ExportSettings>[] = [
      { flow: 'fixed', flowLimit: 3 },
      { memoryBudget: 1024 },
      { recordMemory: true },
      { inWorker: false },
      { gifFps: 25, gifDither: false, gifLoop: false },
    ]
    for (const edit of edits) {
      assert.equal(await fingerprintOf(project(), { ...settings(), ...edit }), base, JSON.stringify(edit))
    }
  })
})

describe('recipe', () => {
  it('lists the sources by name, size and date, without the files', () => {
    assert.deepEqual(sourceRefs(project()), [
      { id: 's1', name: 'a.mp4', size: 1000, lastModified: 111 },
      { id: 's2', name: 'b.webm', size: 2000, lastModified: 222 },
    ])
  })

  it('carries everything an export needs but the files, and goes through text', () => {
    const recipe = makeRecipe(project(), settings())
    assert.equal(recipe.clips.length, 2)
    assert.equal(recipe.texts.length, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(recipe)), recipe)
    assert.ok(!JSON.stringify(recipe).includes('blob:'))
  })
})
