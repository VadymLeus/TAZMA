// tests/standRun.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultSettings } from '../src/export/settings.ts'
import type { ExportResult } from '../src/export/types.ts'
import {
  METRICS,
  counted,
  failures,
  formatValue,
  pairedRatios,
  pairedSummary,
  summaryOf,
} from '../src/stand/aggregate.ts'
import { RECORD_COLUMNS, failedRecord, recordOf } from '../src/stand/record.ts'
import type { RunMeta, RunRecord } from '../src/stand/record.ts'
import { runSchedule } from '../src/stand/runner.ts'
import { makeSchedule } from '../src/stand/schedule.ts'
import {
  cleanLimits,
  flowSeries,
  ignoredCounts,
  ignoredPercents,
  journalCostSeries,
  makeSeries,
  parseCounts,
  parseLimits,
  parsePercents,
} from '../src/stand/series.ts'
import { WHOLE } from '../src/stand/projects.ts'

const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
  series: 's',
  condition: 'a',
  label: 'A',
  index: 0,
  round: 0,
  warmup: false,
  ...over,
})

function result(over: Partial<ExportResult> = {}): ExportResult {
  return {
    blob: new Blob([]),
    mimeType: 'video/webm',
    bytes: 2 * 1024 * 1024,
    elapsedMs: 4000,
    frames: 400,
    width: 1280,
    height: 720,
    duration: 20,
    hasAudio: true,
    settings: { ...defaultSettings, container: 'webm', videoCodec: 'vp9', mode: 'selective', flow: 'auto' },
    stats: {
      mode: 'selective',
      framesCopied: 300,
      framesRecoded: 100,
      copiedSeconds: 15,
      recodedSeconds: 5,
      runs: 2,
      fallbackGops: 0,
      rewrittenPackets: 0,
    },
    flow: { limit: 6, peak: 7, budgetBytes: 64 * 1024 * 1024, byMemory: 5 } as ExportResult['flow'],
    memory: { peakFrames: 9, peakFrameBytes: 10 * 1024 * 1024, peakHeapBytes: 50 * 1024 * 1024 } as ExportResult['memory'],
    journal: {
      job: 'j',
      segments: 4,
      segmentSeconds: 5,
      resumedFrom: 0,
      journalBytes: 3 * 1024 * 1024,
      commits: 4,
      commitMs: 40,
      checkpointMs: 240,
      audioMs: 100,
      videoMs: 3500,
      assembleMs: 200,
    },
    thread: 'worker',
    ui: { longTasks: 1, longestMs: 80, totalMs: 80, maxGapMs: null },
    notes: ['one', 'two'],
    release: async () => {},
    ...over,
  }
}

const record = (over: Partial<RunRecord> = {}): RunRecord => ({ ...recordOf(meta(), result(), 4100), ...over })

describe('recordOf', () => {
  it('turns a result into the figures of a row', () => {
    const row = recordOf(meta(), result(), 4100.4)
    assert.equal(row.ok, true)
    assert.equal(row.wallMs, 4100)
    assert.equal(row.elapsedMs, 4000)
    assert.equal(row.fps, 100)
    assert.equal(row.realtime, 5)
    assert.equal(row.copiedShare, 0.75)
    assert.equal(row.limit, 6)
    assert.equal(row.peakFrames, 9)
    assert.equal(row.peakFrameMiB, 10)
    assert.equal(row.peakHeapMiB, 50)
    assert.equal(row.codec, 'webm/vp9')
    assert.equal(row.checkpointMs, 60)
    assert.equal(row.commitMs, 10)
    assert.equal(row.journalMiB, 3)
    assert.equal(row.notes, 'one | two')
    assert.equal(row.longestUiMs, 80)
  })

  it('carries what the automatic limit worked out and when the peak came', () => {
    const flow = {
      limit: 6,
      peak: 7,
      budgetBytes: 128 * 1024 * 1024,
      byMemory: 5,
      byThroughput: 6,
      tried: 2,
      climbedTo: 12,
      rate: 133.4,
      probeRate: 140.2,
      latencyMs: 41.7,
      firstLatencyMs: 116.2,
      trials: [
        { limit: 17, rate: 452.4 },
        { limit: 48, rate: 567.1 },
      ],
    } as ExportResult['flow']
    const memory = {
      peakFrames: 9,
      peakFrameBytes: 10 * 1024 * 1024,
      peakHeapBytes: null,
      points: [
        { ms: 100, time: 0, frames: 3, frameBytes: 1, heapBytes: null, limit: 1, credits: 1 },
        { ms: 1200, time: 1, frames: 9, frameBytes: 1, heapBytes: null, limit: 16, credits: 9 },
      ],
    } as ExportResult['memory']
    const row = recordOf(meta(), result({ flow, memory }), 1)
    assert.equal(row.byThroughput, 6)
    assert.equal(row.tried, 2)
    assert.equal(row.climbedTo, 12)
    assert.equal(row.trials, '17:452;48:567')
    assert.equal(row.lambdaFps, 133.4)
    assert.equal(row.probeFps, 140.2)
    assert.equal(row.w0Ms, 41.7)
    assert.equal(row.w0FirstMs, 116.2)
    assert.equal(row.peakAtMs, 1200)
    assert.equal(row.limitAtPeak, 16)
  })

  it('leaves them empty without a limit or without readings', () => {
    const row = recordOf(meta(), result({ flow: null, memory: null }), 1)
    assert.equal(row.byThroughput, null)
    assert.equal(row.tried, null)
    assert.equal(row.climbedTo, null)
    assert.equal(row.trials, '')
    assert.equal(row.lambdaFps, null)
    assert.equal(row.probeFps, null)
    assert.equal(row.w0Ms, null)
    assert.equal(row.w0FirstMs, null)
    assert.equal(row.peakAtMs, null)
    assert.equal(row.limitAtPeak, null)
    const plain = recordOf(meta(), result(), 1)
    assert.equal(plain.peakAtMs, null)
    assert.equal(plain.trials, '')
  })

  it('carries the times of the frame loop, and leaves the plan to the stand', () => {
    const row = recordOf(meta(), result({ stages: { waitMs: 1200, composeMs: 300, encodeMs: 2500, firstFrameMs: 90 } }), 1)
    assert.equal(row.waitMs, 1200)
    assert.equal(row.composeMs, 300)
    assert.equal(row.encodeMs, 2500)
    assert.equal(row.firstFrameMs, 90)
    assert.equal(row.plannedShare, null)
    assert.equal(row.blockers, '')
    const bare = recordOf(meta(), result(), 1)
    assert.equal(bare.waitMs, null)
    assert.equal(bare.firstFrameMs, null)
  })

  it('carries when the decoder was first asked for a frame and how long that frame took', () => {
    const row = recordOf(meta(), result({ stages: { decodeAskMs: 812, firstSampleMs: 366 } }), 1)
    assert.equal(row.decodeAskMs, 812)
    assert.equal(row.firstSampleMs, 366)
    const bare = recordOf(meta(), result(), 1)
    assert.equal(bare.decodeAskMs, null)
    assert.equal(bare.firstSampleMs, null)
    assert.ok(RECORD_COLUMNS.includes('decodeAskMs'))
    assert.ok(RECORD_COLUMNS.includes('firstSampleMs'))
  })

  it('leaves what the export did not measure empty', () => {
    const row = recordOf(meta(), result({ journal: null, memory: null, flow: null, ui: null, notes: undefined }), 1)
    assert.equal(row.checkpointMs, null)
    assert.equal(row.journalMiB, null)
    assert.equal(row.peakFrameMiB, null)
    assert.equal(row.peakHeapMiB, null)
    assert.equal(row.limit, null)
    assert.equal(row.longestUiMs, null)
    assert.equal(row.notes, '')
  })

  it('has no copied share when nothing was counted, and no checkpoint cost with no commits', () => {
    const none = result()
    none.stats = { ...none.stats, copiedSeconds: 0, recodedSeconds: 0 }
    if (none.journal) none.journal = { ...none.journal, commits: 0 }
    const row = recordOf(meta(), none, 1)
    assert.equal(row.copiedShare, null)
    assert.equal(row.checkpointMs, null)
  })

  it('writes the memory budget and the limit it allows, and none without a gate', () => {
    const row = recordOf(meta(), result(), 1)
    assert.equal(row.budgetMiB, 64)
    assert.equal(row.memLimit, 5)
    const bare = recordOf(meta(), result({ flow: null }), 1)
    assert.equal(bare.budgetMiB, null)
    assert.equal(bare.memLimit, null)
  })

  it('has a value for every column that CSV writes', () => {
    const row = recordOf(meta(), result(), 1)
    for (const column of RECORD_COLUMNS) assert.ok(column in row, column)
  })
})

describe('failedRecord', () => {
  it('keeps who failed and why, with no figures', () => {
    const row = failedRecord(meta(), new RangeError('no memory'), 12.6)
    assert.equal(row.ok, false)
    assert.equal(row.error, 'RangeError: no memory')
    assert.equal(row.wallMs, 13)
    assert.equal(row.elapsedMs, null)
    assert.equal(failedRecord(meta(), 'plain', 1).error, 'plain')
  })
})

describe('aggregate', () => {
  const rows: RunRecord[] = [
    record({ condition: 'a', round: -1, warmup: true, elapsedMs: 9000 }),
    record({ condition: 'a', round: 0, elapsedMs: 4000 }),
    record({ condition: 'b', round: 0, elapsedMs: 5000 }),
    record({ condition: 'a', round: 1, elapsedMs: 4400 }),
    record({ condition: 'b', round: 1, elapsedMs: 4400 }),
    failedRecord(meta({ condition: 'b', round: 2 }), new Error('x'), 1),
    record({ condition: 'a', round: 2, elapsedMs: 3600 }),
  ]

  it('leaves out warm-ups and failures, and keeps the order of conditions', () => {
    const groups = counted(rows)
    assert.deepEqual([...groups.keys()], ['a', 'b'])
    assert.equal(groups.get('a')?.length, 3)
    assert.equal(groups.get('b')?.length, 2)
  })

  it('summarizes a metric of one condition', () => {
    const found = summaryOf(rows, 'a', 'elapsedMs')
    assert.equal(found?.n, 3)
    assert.equal(found?.median, 4000)
    assert.equal(summaryOf(rows, 'nope', 'elapsedMs'), null)
  })

  it('counts the failures of a condition', () => {
    assert.equal(failures(rows, 'b'), 1)
    assert.equal(failures(rows, 'a'), 0)
  })

  it('takes ratios within a round, so that a drift cancels out', () => {
    const ratios = pairedRatios(rows, 'b', 'a', 'elapsedMs')
    assert.deepEqual(ratios, [5000 / 4000, 4400 / 4400])
    assert.equal(pairedSummary(rows, 'b', 'a', 'elapsedMs')?.n, 2)
  })

  it('skips a round where one of the pair is missing or the denominator is 0', () => {
    const odd: RunRecord[] = [
      record({ condition: 'a', round: 0, elapsedMs: 0 }),
      record({ condition: 'b', round: 0, elapsedMs: 100 }),
      record({ condition: 'b', round: 1, elapsedMs: 100 }),
    ]
    assert.deepEqual(pairedRatios(odd, 'b', 'a', 'elapsedMs'), [])
  })

  it('shows a value in the units of its metric with a comma', () => {
    const time = METRICS.find((metric) => metric.key === 'elapsedMs')
    const share = METRICS.find((metric) => metric.key === 'copiedShare')
    assert.ok(time && share)
    assert.equal(formatValue(4321, time), '4,3')
    assert.equal(formatValue(0.755, share), '76')
  })
})

describe('series', () => {
  const options = { seconds: 30, limits: [8, 2, 2, 0, -1, 1.5, 4], segmentSeconds: 10, intervals: [4, 1, 2], mtbfSeconds: 8, shares: [0, 0.5], cutCounts: [0, 2], cuts: 0, share: 0.25, kind: 'text' as const }

  it('cleans the limits to whole numbers, each once, rising', () => {
    assert.deepEqual(cleanLimits(options.limits), [2, 4, 8])
    assert.deepEqual(cleanLimits([]), [])
  })

  it('reads the limits a person types', () => {
    assert.deepEqual(parseLimits('1, 2;4  8,,16'), [1, 2, 4, 8, 16])
    assert.deepEqual(parseLimits('8 x 2 0 -3 2.5'), [2, 8])
    assert.deepEqual(parseLimits(''), [])
  })

  it('shows the ratio of memory as well as of time for the limits', () => {
    const series = flowSeries(options)
    assert.ok(series.pairs.every((pair) => pair.keys?.includes('peakFrameMiB') && pair.keys.includes('elapsedMs')))
  })

  it('measures the cost of the journal on four conditions with two pairs', () => {
    const series = journalCostSeries(options)
    assert.deepEqual(series.conditions.map((condition) => condition.id), [
      'full-plain', 'full-journal', 'selective-plain', 'selective-journal',
    ])
    const journal = series.conditions.find((condition) => condition.id === 'selective-journal')
    assert.equal(journal?.settings.resumable, true)
    assert.equal(journal?.settings.segmentSeconds, 10)
    assert.equal(journal?.spec.seconds, 30)
    assert.equal(series.conditions.find((condition) => condition.id === 'full-plain')?.settings.resumable, false)
    assert.equal(series.pairs.length, 2)
  })

  it('runs the same project in every condition of a series', () => {
    for (const series of [journalCostSeries(options), flowSeries(options)]) {
      const first = JSON.stringify(series.conditions[0].spec)
      assert.ok(series.conditions.every((condition) => JSON.stringify(condition.spec) === first))
      assert.equal(new Set(series.conditions.map((condition) => condition.id)).size, series.conditions.length)
    }
  })

  it('sets the frame limit by library, fixed limits and auto', () => {
    const series = flowSeries(options)
    assert.deepEqual(series.conditions.map((condition) => condition.id), ['library', 'fixed-2', 'fixed-4', 'fixed-8', 'auto'])
    assert.equal(series.conditions[0].settings.flow, 'library')
    assert.equal(series.conditions[2].settings.flowLimit, 4)
    assert.ok(series.conditions.every((condition) => condition.settings.mode === 'full'))
    assert.ok(series.pairs.every((pair) => pair.denominator === 'library'))
    assert.equal(series.pairs.length, 4)
  })

  it('has a series for every choice', () => {
    assert.equal(makeSeries('journal', options).id, 'journal')
    assert.equal(makeSeries('flow', options).id, 'flow')
  })

  it('uses the whole file when the seconds are 0', () => {
    assert.equal(journalCostSeries({ ...options, seconds: 0 }).conditions[0].spec.seconds, 0)
    assert.equal(WHOLE.cuts, 0)
  })
})

describe('runSchedule', () => {
  const series = flowSeries({ seconds: 10, limits: [2], segmentSeconds: 10, intervals: [], mtbfSeconds: 8, shares: [0, 0.5], cutCounts: [0, 2], cuts: 0, share: 0.25, kind: 'text' as const })
  const schedule = makeSchedule({ conditions: series.conditions.map((condition) => condition.id), repeats: 2, seed: 1, warmupRuns: 1 })

  it('runs the schedule in order, writes every run down and frees every result', async () => {
    const order: string[] = []
    let released = 0
    const records = await runSchedule({
      series,
      schedule,
      coolDownMs: 0,
      execute: async (condition) => {
        order.push(condition.id)
        return result({ release: async () => void released++ })
      },
    })
    assert.deepEqual(order, schedule.map((run) => run.condition))
    assert.equal(records.length, schedule.length)
    assert.equal(released, schedule.length)
    assert.equal(records[0].warmup, true)
    assert.deepEqual(records.map((row) => row.index), schedule.map((run) => run.index))
  })

  it('writes a failed run down and goes on', async () => {
    let calls = 0
    const records = await runSchedule({
      series,
      schedule,
      coolDownMs: 0,
      execute: async () => {
        calls++
        if (calls === 3) throw new Error('out of memory')
        return result()
      },
    })
    assert.equal(records.length, schedule.length)
    assert.equal(records.filter((row) => !row.ok).length, 1)
    assert.match(records[2].error, /out of memory/)
  })

  it('stops when told to, keeping what is done', async () => {
    const controller = new AbortController()
    const records = await runSchedule({
      series,
      schedule,
      coolDownMs: 0,
      signal: controller.signal,
      execute: async () => result(),
      onRecord: (_row, done) => {
        if (done === 2) controller.abort()
      },
    })
    assert.equal(records.length, 2)
  })

  it('does not count a run that was stopped in the middle as a failure', async () => {
    const controller = new AbortController()
    const records = await runSchedule({
      series,
      schedule,
      coolDownMs: 0,
      signal: controller.signal,
      execute: async () => {
        controller.abort()
        throw new Error('aborted')
      },
    })
    assert.equal(records.length, 0)
  })

  it('rests between runs but not after the last, and reports progress', async () => {
    const rests: number[] = []
    const seen: number[] = []
    await runSchedule({
      series,
      schedule,
      coolDownMs: 250,
      pause: async (ms) => void rests.push(ms),
      execute: async () => result(),
      onStart: (_run, _condition, done) => void seen.push(done),
    })
    assert.equal(rests.length, schedule.length - 1)
    assert.ok(rests.every((ms) => ms === 250))
    assert.deepEqual(seen, schedule.map((_, index) => index))
  })

  it('refuses a schedule that names a condition the series does not have', async () => {
    await assert.rejects(
      runSchedule({
        series,
        schedule: [{ index: 0, condition: 'ghost', round: 0, warmup: false }],
        coolDownMs: 0,
        execute: async () => result(),
      }),
      /ghost/,
    )
  })
})

describe('quality columns and the series of the share and the cuts', () => {
  it('writes the quality of a result into the row', () => {
    const row = recordOf(
      meta(),
      { ...result(), quality: { frames: 8, identical: 6, psnrMean: 41.5, psnrMin: 38, ssimMean: 0.99, ssimMin: 0.97 } },
      4100,
    )
    assert.equal(row.psnrMean, 41.5)
    assert.equal(row.psnrMin, 38)
    assert.equal(row.ssimMean, 0.99)
    assert.equal(row.ssimMin, 0.97)
    assert.equal(row.identicalShare, 0.75)
  })

  it('leaves them empty without a comparison', () => {
    const row = recordOf(meta(), result(), 4100)
    assert.equal(row.psnrMean, null)
    assert.equal(row.identicalShare, null)
  })

  const options = {
    seconds: 40,
    limits: [],
    segmentSeconds: 10,
    intervals: [],
    mtbfSeconds: 8,
    shares: [0.5, 0, 0.25, 0.25, 2],
    cutCounts: [3, 0, 1, 1, -1, 1.5],
    cuts: 2,
    share: 0.25,
    kind: 'effect' as const,
  }

  it('runs both modes on every share, rising', () => {
    const series = makeSeries('share', options)
    assert.deepEqual(series.conditions.map((c) => c.id), ['full-0', 'sel-0', 'full-0.25', 'sel-0.25', 'full-0.5', 'sel-0.5'])
    assert.equal(series.quality, true)
    const selective = series.conditions.find((c) => c.id === 'sel-0.25')
    assert.equal(selective?.settings.mode, 'selective')
    assert.deepEqual(selective?.spec, { cuts: 2, share: 0.25, kind: 'effect', seconds: 40 })
    assert.equal(series.conditions.find((c) => c.id === 'full-0.25')?.spec, selective?.spec)
  })

  it('pairs the selective run with the full one of the same project', () => {
    const series = makeSeries('share', options)
    assert.deepEqual(series.pairs.map((p) => [p.numerator, p.denominator]), [
      ['sel-0', 'full-0'],
      ['sel-0.25', 'full-0.25'],
      ['sel-0.5', 'full-0.5'],
    ])
  })

  it('varies the cuts and holds the share', () => {
    const series = makeSeries('cuts', options)
    assert.deepEqual(series.conditions.map((c) => c.id), ['full-0', 'sel-0', 'full-1', 'sel-1', 'full-3', 'sel-3'])
    assert.deepEqual(series.conditions.find((c) => c.id === 'sel-3')?.spec, { cuts: 3, share: 0.25, kind: 'effect', seconds: 40 })
    assert.match(series.conditions.find((c) => c.id === 'sel-1')?.label ?? '', /1 розріз$/)
    assert.match(series.conditions.find((c) => c.id === 'sel-0')?.label ?? '', /без розрізів$/)
  })
})

describe('lists of numbers typed for the series', () => {
  it('reads percentages as fractions and drops what is out of range', () => {
    assert.deepEqual(parsePercents('0, 10; 25 25 100 101 -5 x'), [0, 0.1, 0.25, 1])
    assert.deepEqual(ignoredPercents('0, 10; 25 25 100 101 -5 x'), ['101', '-5', 'x'])
  })

  it('reads whole numbers of cuts', () => {
    assert.deepEqual(parseCounts('0 1 3 3 2.5 -1 101'), [0, 1, 3])
    assert.deepEqual(ignoredCounts('0 1 3 3 2.5 -1 101'), ['2.5', '-1', '101'])
  })
})
