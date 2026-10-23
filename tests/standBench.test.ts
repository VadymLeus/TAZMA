// tests/standBench.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyStages } from '../src/export/stageTimes.ts'
import { defaultSettings } from '../src/export/settings.ts'
import { ExportAborted } from '../src/export/types.ts'
import { toWireError } from '../src/export/worker/protocol.ts'
import { METRICS } from '../src/stand/aggregate.ts'
import { runBenchInWorker } from '../src/stand/bench/benchClient.ts'
import type { BenchWorkerLike } from '../src/stand/bench/benchClient.ts'
import { benchResult } from '../src/stand/bench/benchResult.ts'
import { BENCH_KINDS, isBenchKind } from '../src/stand/bench/protocol.ts'
import type { BenchOutput, BenchSpec, FromBench, ToBench } from '../src/stand/bench/protocol.ts'
import { planConditions } from '../src/stand/plans.ts'
import { recordOf } from '../src/stand/record.ts'
import { SERIES_CHOICES, componentsSeries, makeSeries } from '../src/stand/series.ts'
import type { SeriesOptions } from '../src/stand/series.ts'
import type { Source } from '../src/project/types.ts'

class FakeWorker implements BenchWorkerLike {
  sent: ToBench[] = []
  terminated = 0
  onmessage: BenchWorkerLike['onmessage'] = null
  onerror: BenchWorkerLike['onerror'] = null
  postMessage(message: ToBench) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated++
  }
  say(message: FromBench) {
    this.onmessage?.({ data: message })
  }
}

const spec = (): BenchSpec => ({
  kind: 'copy-null',
  file: new Blob([]) as unknown as File,
  seconds: 10,
  videoCodec: 'avc',
  quality: 'medium',
})

const output = (over: Partial<BenchOutput> = {}): BenchOutput => ({
  frames: 300,
  bytes: 2_000_000,
  duration: 10,
  width: 1280,
  height: 720,
  elapsedMs: 500,
  stages: { ...emptyStages(), readMs: 120, sendMs: 200, startRunMs: 40, firstItemMs: 15 },
  notes: ['a', 'b'],
  ...over,
})

const OPTIONS: SeriesOptions = {
  seconds: 10,
  limits: [4],
  segmentSeconds: 5,
  intervals: [2],
  mtbfSeconds: 8,
  shares: [0.25],
  cutCounts: [0],
  cuts: 0,
  share: 0.25,
  kind: 'text',
}

describe('runBenchInWorker', () => {
  it('sends the spec, resolves with the output and ends the worker', async () => {
    const worker = new FakeWorker()
    const promise = runBenchInWorker(spec(), undefined, () => worker)
    assert.equal(worker.sent.length, 1)
    assert.equal(worker.sent[0].type, 'start')
    worker.say({ type: 'ready' })
    worker.say({ type: 'done', output: output() })
    const got = await promise
    assert.equal(got.frames, 300)
    assert.equal(worker.terminated, 1)
  })

  it('rejects with the error the worker reports', async () => {
    const worker = new FakeWorker()
    const promise = runBenchInWorker(spec(), undefined, () => worker)
    worker.say({ type: 'error', error: toWireError(new RangeError('no video')) })
    await assert.rejects(promise, (error: Error) => error.name === 'RangeError' && error.message === 'no video')
    assert.equal(worker.terminated, 1)
  })

  it('rejects when the worker stops by itself', async () => {
    const worker = new FakeWorker()
    const promise = runBenchInWorker(spec(), undefined, () => worker)
    worker.onerror?.({ message: 'boom' })
    await assert.rejects(promise, /boom/)
    assert.equal(worker.terminated, 1)
  })

  it('does not start when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    let made = 0
    await assert.rejects(
      runBenchInWorker(spec(), controller.signal, () => {
        made++
        return new FakeWorker()
      }),
      ExportAborted,
    )
    assert.equal(made, 0)
  })

  it('asks the worker to stop on abort and gives up after the grace', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const promise = runBenchInWorker(spec(), controller.signal, () => worker, 20)
    controller.abort()
    assert.equal(worker.sent[1]?.type, 'abort')
    await assert.rejects(promise, ExportAborted)
    assert.equal(worker.terminated, 1)
  })

  it('takes the answer of the worker that stops in time', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const promise = runBenchInWorker(spec(), controller.signal, () => worker, 1000)
    controller.abort()
    worker.say({ type: 'error', error: toWireError(new ExportAborted()) })
    await assert.rejects(promise, ExportAborted)
  })
})

describe('benchResult', () => {
  it('is recorded like an export, with the mode named after the part', () => {
    const result = benchResult('copy-null', output(), { ...defaultSettings, mode: 'full' })
    const row = recordOf(
      { series: 'components', condition: 'copy-null', label: 'x', index: 0, round: 0, warmup: false },
      result,
      620,
    )
    assert.equal(row.mode, 'bench-copy-null')
    assert.equal(row.elapsedMs, 500)
    assert.equal(row.frames, 300)
    assert.equal(row.fps, 600)
    assert.equal(row.bytes, 2_000_000)
    assert.equal(row.readMs, 120)
    assert.equal(row.sendMs, 200)
    assert.equal(row.startRunMs, 40)
    assert.equal(row.firstItemMs, 15)
    assert.equal(row.firstFrameMs, null)
    assert.equal(row.copiedShare, null)
    assert.equal(row.notes, 'a | b')
  })
})

describe('bench kinds', () => {
  it('knows its names', () => {
    for (const kind of BENCH_KINDS) assert.equal(isBenchKind(kind), true)
    assert.equal(isBenchKind('full'), false)
  })
})

describe('componentsSeries', () => {
  const series = componentsSeries(OPTIONS)

  it('is offered and made by name', () => {
    assert.ok(SERIES_CHOICES.some((choice) => choice.id === 'components'))
    assert.equal(makeSeries('components', OPTIONS).id, 'components')
  })

  it('times every kind of part once, beside a full and a selective export', () => {
    const benches = series.conditions.filter((condition) => condition.bench).map((condition) => condition.bench)
    assert.deepEqual(benches, [...BENCH_KINDS])
    const ids = series.conditions.map((condition) => condition.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(series.conditions.find((c) => c.id === 'ref-full')?.settings.mode, 'full')
    assert.equal(series.conditions.find((c) => c.id === 'ref-sel')?.settings.mode, 'selective')
  })

  it('has pairs and figures that exist', () => {
    const ids = new Set(series.conditions.map((condition) => condition.id))
    for (const pair of series.pairs) {
      assert.ok(ids.has(pair.numerator), pair.numerator)
      assert.ok(ids.has(pair.denominator), pair.denominator)
    }
    const known = new Set(METRICS.map((metric) => metric.key as string))
    for (const key of [...series.metrics, ...series.pairs.flatMap((pair) => pair.keys ?? [])]) {
      assert.ok(known.has(key), key)
    }
  })

  it('shows the new stage figures in the other series too', () => {
    const known = new Set(METRICS.map((metric) => metric.key as string))
    for (const choice of SERIES_CHOICES) {
      for (const key of makeSeries(choice.id, OPTIONS).metrics) assert.ok(known.has(key), `${choice.id}: ${key}`)
    }
    for (const id of ['journal', 'share', 'cuts'] as const) {
      assert.ok(makeSeries(id, OPTIONS).metrics.includes('firstItemMs'), id)
    }
  })

  it('plans only the selective export, whatever the base mode is', async () => {
    const source = { id: 's0', file: new Blob([]) as unknown as File, url: '', info: { duration: 60, video: { frameRate: 30 } } } as unknown as Source
    const found = await planConditions(
      series,
      source,
      { ...defaultSettings, mode: 'selective', container: 'mp4', videoCodec: 'avc' },
      (async () => ({ summary: { copySeconds: 5, recodeSeconds: 5 }, blockers: new Map() })) as never,
    )
    assert.deepEqual([...found.keys()], ['ref-sel', 'ref-sel-lib'])
  })
})
