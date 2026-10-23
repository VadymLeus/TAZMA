// tests/standPlans.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ProjectPlan } from '../src/export/selectiveAnalysis.ts'
import { defaultSettings } from '../src/export/settings.ts'
import type { ExportSettings } from '../src/export/types.ts'
import type { Source } from '../src/project/types.ts'
import { nothingCopied, planConditions, planFigures } from '../src/stand/plans.ts'
import type { PlanFigures } from '../src/stand/plans.ts'
import { makeSeries } from '../src/stand/series.ts'
import type { SeriesOptions } from '../src/stand/series.ts'

const plan = (copySeconds: number, recodeSeconds: number, blockers: [string, string[]][] = []): ProjectPlan =>
  ({
    summary: { copySeconds, recodeSeconds },
    blockers: new Map(blockers),
  }) as unknown as ProjectPlan

const OPTIONS: SeriesOptions = {
  seconds: 60,
  limits: [2],
  segmentSeconds: 30,
  intervals: [4],
  mtbfSeconds: 8,
  shares: [0, 0.5],
  cutCounts: [0, 3],
  cuts: 0,
  share: 0.25,
  kind: 'text',
}

const source = { id: 's0', info: { duration: 600 } } as unknown as Source
const settings: ExportSettings = { ...defaultSettings, mode: 'full', container: 'mp4', videoCodec: 'avc' }

describe('planFigures', () => {
  it('takes the planned share and lists each blocker once', () => {
    const figures = planFigures(plan(45, 15, [['a', ['color', 'params']], ['b', ['color']]]))
    assert.equal(figures.plannedShare, 0.75)
    assert.equal(figures.blockers, 'color+params')
  })

  it('has no share for an empty plan and no blockers when nothing stands in the way', () => {
    const figures = planFigures(plan(0, 0))
    assert.equal(figures.plannedShare, null)
    assert.equal(figures.blockers, '')
  })
})

describe('nothingCopied', () => {
  const figures = (...shares: (number | null)[]) =>
    new Map<string, PlanFigures>(shares.map((share, i) => [`c${i}`, { plannedShare: share, blockers: share ? '' : 'color' }]))

  it('is silent when some condition copies, and when there is no selective condition', () => {
    assert.equal(nothingCopied(figures(0, 0.4)), null)
    assert.equal(nothingCopied(new Map()), null)
  })

  it('names the reason when nothing is copied', () => {
    const message = nothingCopied(figures(0, null, 0.001))
    assert.ok(message?.startsWith('Вибірковий експорт нічого не скопіює.'))
    assert.ok(message?.includes('інший колірний простір'), message)
  })
})

describe('planConditions', () => {
  it('plans the selective conditions only, once per project', async () => {
    const calls: number[] = []
    const planner = async (project: { clips: unknown[]; texts: unknown[] }, planned: ExportSettings) => {
      calls.push(project.texts.length)
      assert.equal(planned.mode, 'selective')
      return plan(project.texts.length > 0 ? 30 : 60, 30, [['s0', ['color']]])
    }
    const series = makeSeries('share', OPTIONS)
    const result = await planConditions(series, source, settings, planner as never)
    assert.equal(calls.length, 2)
    assert.deepEqual([...result.keys()], ['sel-0', 'sel-0.5'])
    assert.equal(result.get('sel-0')?.plannedShare, 60 / 90)
    assert.equal(result.get('sel-0.5')?.blockers, 'color')
  })

  it('shares one plan between conditions of the same project', async () => {
    let count = 0
    const series = makeSeries('journal', OPTIONS)
    const result = await planConditions(series, source, settings, (async () => {
      count++
      return plan(10, 0)
    }) as never)
    assert.equal(count, 1)
    assert.deepEqual([...result.keys()], ['selective-plain', 'selective-journal'])
  })

  it('has nothing to plan for a series in the full mode', async () => {
    const result = await planConditions(makeSeries('flow', OPTIONS), source, settings, (async () => {
      throw new Error('not called')
    }) as never)
    assert.equal(result.size, 0)
  })
})
