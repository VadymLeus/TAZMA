// tests/restore.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ExportSettings } from '../src/export/types.ts'
import { defaultSettings } from '../src/export/settings.ts'
import { fingerprintOf } from '../src/resume/fingerprint.ts'
import { makeRecipe } from '../src/resume/manifest.ts'
import { matchSources, mergeSettings, missingText, restoreProject } from '../src/resume/restore.ts'
import type { MediaInfo } from '../src/media/probe.ts'
import type { Source } from '../src/project/types.ts'

const fakeFile = (name: string, size: number, lastModified: number): File =>
  ({ name, size, lastModified }) as unknown as File

const info = (name: string) => ({ fileName: name }) as unknown as MediaInfo

const source = (id: string, file: File): Source => ({ id, file, url: '', info: info(file.name) })

const project = () => {
  const a = fakeFile('a.mp4', 1000, 111)
  const b = fakeFile('b.webm', 2000, 222)
  return {
    clips: [
      { id: 'c1', sourceId: 's1', start: 0, end: 5 },
      { id: 'c2', sourceId: 's2', start: 1, end: 3, effect: { kind: 'grayscale' as const, amount: 1 } },
    ],
    texts: [{ id: 't1', text: 'Привіт', start: 0, end: 2, x: 0.5, y: 0.5, size: 0.1, color: '#fff' }],
    sources: [source('s1', a), source('s2', b)],
  }
}

const settings = (over: Partial<ExportSettings> = {}): ExportSettings => ({
  ...defaultSettings,
  mode: 'full',
  resumable: true,
  segmentSeconds: 10,
  ...over,
})

describe('matchSources', () => {
  it('finds the files by name, size and date of change', () => {
    const recipe = makeRecipe(project(), settings())
    const files = [fakeFile('b.webm', 2000, 222), fakeFile('a.mp4', 1000, 111), fakeFile('other.mp4', 1, 1)]
    const { matched, missing } = matchSources(recipe.sources, files)
    assert.equal(missing.length, 0)
    assert.equal(matched.get('s1')?.name, 'a.mp4')
    assert.equal(matched.get('s2')?.name, 'b.webm')
  })

  it('reports a file that is not there', () => {
    const recipe = makeRecipe(project(), settings())
    const { matched, missing } = matchSources(recipe.sources, [fakeFile('a.mp4', 1000, 111)])
    assert.equal(matched.size, 1)
    assert.equal(missing.length, 1)
    assert.equal(missing[0].ref.id, 's2')
    assert.equal(missing[0].sameName, null)
  })

  it('does not take a file of the same name that has changed, but points at it', () => {
    const recipe = makeRecipe(project(), settings())
    const changed = fakeFile('b.webm', 2001, 222)
    const { missing } = matchSources(recipe.sources, [fakeFile('a.mp4', 1000, 111), changed])
    assert.equal(missing.length, 1)
    assert.equal(missing[0].sameName, changed)
    assert.match(missingText(missing[0]), /не збігається/)
  })

  it('does not take a copy with another date of change', () => {
    const recipe = makeRecipe(project(), settings())
    const { missing } = matchSources(recipe.sources, [fakeFile('a.mp4', 1000, 999), fakeFile('b.webm', 2000, 222)])
    assert.deepEqual(missing.map((item) => item.ref.id), ['s1'])
  })

  it('names a file that is simply needed', () => {
    const recipe = makeRecipe(project(), settings())
    const { missing } = matchSources(recipe.sources, [])
    assert.equal(missingText(missing[0]), 'Потрібен файл «a.mp4».')
  })
})

describe('restoreProject', () => {
  it('builds the project again with the same ids, clips and captions', async () => {
    const original = project()
    const recipe = makeRecipe(original, settings())
    const files = [fakeFile('b.webm', 2000, 222), fakeFile('a.mp4', 1000, 111)]
    const result = await restoreProject(JSON.parse(JSON.stringify(recipe)), files, async (file) => info(file.name))
    assert.ok(result.project)
    assert.deepEqual(result.project.clips, original.clips)
    assert.deepEqual(result.project.texts, original.texts)
    assert.deepEqual(result.project.sources.map((s) => [s.id, s.file.name, s.info]), [
      ['s1', 'a.mp4', info('a.mp4')],
      ['s2', 'b.webm', info('b.webm')],
    ])
  })

  it('gives the same fingerprint as the project it came from', async () => {
    const original = project()
    const recorded = settings()
    const recipe = JSON.parse(JSON.stringify(makeRecipe(original, recorded)))
    const files = [fakeFile('a.mp4', 1000, 111), fakeFile('b.webm', 2000, 222)]
    const result = await restoreProject(recipe, files, async (file) => info(file.name))
    assert.ok(result.project)
    assert.equal(
      await fingerprintOf(result.project, mergeSettings(recipe.settings, settings({ flow: 'fixed', flowLimit: 9 }))),
      await fingerprintOf(original, recorded),
    )
  })

  it('returns nothing while a file is missing and does not probe', async () => {
    const recipe = makeRecipe(project(), settings())
    let probed = 0
    const result = await restoreProject(recipe, [fakeFile('a.mp4', 1000, 111)], async (file) => {
      probed++
      return info(file.name)
    })
    assert.equal(result.project, null)
    assert.equal(result.missing.length, 1)
    assert.equal(probed, 0)
  })
})

describe('mergeSettings', () => {
  it('keeps what shapes the output from the record and the rest from now', () => {
    const recorded = settings({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', quality: 'high', height: 480, segmentSeconds: 20, flow: 'auto' })
    const current = settings({ container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', quality: 'low', height: null, flow: 'fixed', flowLimit: 12, inWorker: false, recordMemory: false })
    const merged = mergeSettings(recorded, current)
    assert.equal(merged.container, 'webm')
    assert.equal(merged.videoCodec, 'vp9')
    assert.equal(merged.audioCodec, 'opus')
    assert.equal(merged.quality, 'high')
    assert.equal(merged.height, 480)
    assert.equal(merged.segmentSeconds, 20)
    assert.equal(merged.flow, 'fixed')
    assert.equal(merged.flowLimit, 12)
    assert.equal(merged.inWorker, false)
    assert.equal(merged.recordMemory, false)
    assert.equal(merged.resumable, true)
  })
})
