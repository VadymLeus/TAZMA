// tests/continueJob.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultSettings } from '../src/export/settings.ts'
import type { ExportSettings } from '../src/export/types.ts'
import type { MediaInfo } from '../src/media/probe.ts'
import { prepareContinue } from '../src/resume/continueJob.ts'
import { writeManifest } from '../src/resume/journal.ts'
import { makeRecipe, newManifest } from '../src/resume/manifest.ts'
import { memoryStore } from '../src/resume/store.ts'
import type { JournalStore } from '../src/resume/store.ts'

const fakeFile = (name: string, size: number, lastModified: number): File =>
  ({ name, size, lastModified }) as unknown as File

const recorded: ExportSettings = {
  ...defaultSettings,
  mode: 'selective',
  container: 'webm',
  videoCodec: 'vp9',
  audioCodec: 'opus',
  resumable: true,
  segmentSeconds: 12,
}

const recipe = () =>
  makeRecipe(
    {
      clips: [{ id: 'c1', sourceId: 's1', start: 0, end: 30 }],
      texts: [],
      sources: [{ id: 's1', file: fakeFile('a.mp4', 1000, 111), url: '', info: {} as MediaInfo }],
    },
    recorded,
  )

async function journal(over: { recipe?: boolean } = {}): Promise<JournalStore> {
  const store = memoryStore()
  await writeManifest(
    store,
    newManifest({ job: 'j', fingerprint: 'f', total: 30, segmentSeconds: 12, recipe: over.recipe === false ? null : recipe(), hasAudio: false, now: 1 }),
  )
  return store
}

const probe = async (file: File) => ({ fileName: file.name }) as unknown as MediaInfo

const current: ExportSettings = { ...defaultSettings, container: 'mp4', mode: 'full', flow: 'fixed', recordMemory: false }

describe('prepareContinue', () => {
  it('builds the project from the recipe and the files, with the settings the export started with', async () => {
    const store = await journal()
    const result = await prepareContinue('j', [fakeFile('a.mp4', 1000, 111)], current, { probe, open: async () => store })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.project.sources[0].info.fileName, 'a.mp4')
    assert.equal(result.project.clips.length, 1)
    assert.equal(result.settings.mode, 'selective')
    assert.equal(result.settings.container, 'webm')
    assert.equal(result.settings.segmentSeconds, 12)
    assert.equal(result.settings.flow, 'fixed')
    assert.equal(result.settings.resumable, true)
  })

  it('names the file that is missing', async () => {
    const store = await journal()
    const result = await prepareContinue('j', [], current, { probe, open: async () => store })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /a\.mp4/)
    assert.equal(result.missing.length, 1)
  })

  it('points at a file of the same name that has changed', async () => {
    const store = await journal()
    const result = await prepareContinue('j', [fakeFile('a.mp4', 1001, 111)], current, { probe, open: async () => store })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.message, /не збігається/)
  })

  it('refuses a job the storage no longer holds', async () => {
    const result = await prepareContinue('j', [], current, { probe, open: async () => null })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /не знайдено/)
  })

  it('refuses a journal that has no recipe, and one that cannot be read', async () => {
    const bare = await prepareContinue('j', [], current, { probe, open: async () => journal({ recipe: false }) })
    assert.equal(bare.ok, false)
    if (!bare.ok) assert.match(bare.message, /немає опису/)

    const broken = memoryStore()
    const file = await broken.create('manifest.json')
    await file.write(new TextEncoder().encode('{nope'))
    await file.commit()
    const result = await prepareContinue('j', [], current, { probe, open: async () => broken })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.message, /Журнал/)
  })
})
