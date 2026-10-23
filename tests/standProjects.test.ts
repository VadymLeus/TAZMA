// tests/standProjects.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MediaInfo } from '../src/media/probe.ts'
import type { Source } from '../src/project/types.ts'
import { timelineDuration } from '../src/project/timeline.ts'
import { WHOLE, buildProject } from '../src/stand/projects.ts'

const source = (duration: number): Source => ({
  id: 's1',
  file: {} as File,
  url: '',
  info: { fileName: 'a.mp4', duration } as MediaInfo,
})

describe('buildProject', () => {
  it('takes the whole file as one clip by default', () => {
    const project = buildProject(source(60), WHOLE)
    assert.equal(project.clips.length, 1)
    assert.deepEqual([project.clips[0].start, project.clips[0].end], [0, 60])
    assert.equal(project.texts.length, 0)
    assert.equal(project.sources.length, 1)
  })

  it('takes the first seconds when asked, and never more than the file has', () => {
    assert.equal(timelineDuration(buildProject(source(60), { ...WHOLE, seconds: 20 }).clips), 20)
    assert.equal(timelineDuration(buildProject(source(10), { ...WHOLE, seconds: 20 }).clips), 10)
  })

  it('makes cuts + 1 clips that follow each other and cover the stretch exactly', () => {
    const project = buildProject(source(120), { ...WHOLE, cuts: 5 })
    assert.equal(project.clips.length, 6)
    assert.equal(project.clips[0].start, 0)
    assert.equal(project.clips[5].end, 120)
    for (let i = 1; i < project.clips.length; i++) assert.equal(project.clips[i].start, project.clips[i - 1].end)
    assert.ok(project.clips.every((clip) => clip.end > clip.start))
    assert.equal(timelineDuration(project.clips), 120)
  })

  it('is the same for the same seed and moves the cuts for another', () => {
    const cuts = (seed: number) => buildProject(source(120), { ...WHOLE, cuts: 4, seed }).clips.map((clip) => clip.end).join()
    assert.equal(cuts(1), cuts(1))
    assert.notEqual(cuts(1), cuts(2))
  })

  it('puts a caption over the wanted share of the timeline, in the middle', () => {
    const project = buildProject(source(100), { ...WHOLE, share: 0.25 })
    assert.equal(project.texts.length, 1)
    assert.equal(project.texts[0].start, 37.5)
    assert.equal(project.texts[0].end, 62.5)
    assert.ok(project.clips.every((clip) => clip.effect === undefined))
  })

  it('covers the whole timeline with a share of 1', () => {
    const text = buildProject(source(30), { ...WHOLE, share: 1 }).texts[0]
    assert.deepEqual([text.start, text.end], [0, 30])
  })

  it('makes the stretch its own clip with the effect when the kind is effect', () => {
    const project = buildProject(source(100), { ...WHOLE, share: 0.4, kind: 'effect' })
    assert.equal(project.texts.length, 0)
    const withEffect = project.clips.filter((clip) => clip.effect)
    assert.equal(withEffect.length, 1)
    assert.deepEqual([withEffect[0].start, withEffect[0].end], [30, 70])
    assert.equal(project.clips.length, 3)
  })

  it('gives every cut clip inside the stretch the effect, and the others not', () => {
    const project = buildProject(source(200), { ...WHOLE, cuts: 8, share: 0.5, kind: 'effect', seed: 3 })
    const covered = project.clips.filter((clip) => clip.effect).reduce((sum, clip) => sum + clip.end - clip.start, 0)
    assert.ok(Math.abs(covered - 100) < 1e-6)
    for (const clip of project.clips) {
      const inside = clip.start >= 50 - 1e-6 && clip.end <= 150 + 1e-6
      assert.equal(clip.effect !== undefined, inside)
    }
  })

  it('refuses a share, cuts or a stretch that make no sense', () => {
    assert.throws(() => buildProject(source(60), { ...WHOLE, share: 1.2 }), RangeError)
    assert.throws(() => buildProject(source(60), { ...WHOLE, share: -0.1 }), RangeError)
    assert.throws(() => buildProject(source(60), { ...WHOLE, cuts: -1 }), RangeError)
    assert.throws(() => buildProject(source(60), { ...WHOLE, cuts: 1.5 }), RangeError)
    assert.throws(() => buildProject(source(0.5), { ...WHOLE, cuts: 5 }), RangeError)
  })
})
