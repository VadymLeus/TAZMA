// tests/selectivePlan.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAvcConfig } from '../src/export/avc.ts'
import { buildSegments } from '../src/export/plan.ts'
import { isClosedGop } from '../src/export/gop.ts'
import { copyBlocker, copyBlockers, planSelective, summarizePlan } from '../src/export/selectivePlan.ts'
import { avcC } from './avcFixture.ts'
import { STREAMS, bytes } from './avcStreams.ts'
import type { SegmentAnalysis } from '../src/export/selectivePlan.ts'
import type { Clip, TextItem } from '../src/project/types.ts'

const clip = (id: string, start: number, end: number, effect?: Clip['effect']): Clip => ({
  id,
  sourceId: 's',
  start,
  end,
  effect,
})

const text = (start: number, end: number): TextItem => ({
  id: `t${start}`,
  text: 'x',
  start,
  end,
  x: 0.5,
  y: 0.5,
  size: 0.1,
  color: '#fff',
})

const keys = (...values: number[]): SegmentAnalysis => ({
  keyframes: values,
  streamEnd: 10,
  copyable: true,
})

const shape = (pieces: ReturnType<typeof planSelective>) =>
  pieces.map((p) => `${p.kind}:${p.from}-${p.to}`)

describe('planSelective', () => {
  it('copies a whole untouched file as one piece', () => {
    const plan = planSelective(buildSegments([clip('a', 0, 10)]), [], [keys(0, 2, 4, 6, 8)])
    assert.deepEqual(shape(plan), ['copy:0-10'])
  })

  it('recodes the partial GOPs at both edges of a trimmed clip', () => {
    const plan = planSelective(buildSegments([clip('a', 1, 9)]), [], [keys(0, 2, 4, 6, 8)])
    assert.deepEqual(shape(plan), ['recode:1-2', 'copy:2-8', 'recode:8-9'])
    assert.deepEqual(
      plan.filter((p) => p.kind === 'recode').map((p) => (p as { parts: { reason: string }[] }).parts[0].reason),
      ['edge', 'edge'],
    )
  })

  it('starts copying right at a key frame', () => {
    const plan = planSelective(buildSegments([clip('a', 2, 8)]), [], [keys(0, 2, 4, 6, 8)])
    assert.deepEqual(shape(plan), ['copy:2-8'])
  })

  it('merges the GOP edges around a caption into one recode run', () => {
    const plan = planSelective(
      buildSegments([clip('a', 0, 10)]),
      [text(3.5, 4.5)],
      [keys(0, 2, 4, 6, 8)],
    )
    assert.deepEqual(shape(plan), ['copy:0-2', 'recode:2-6', 'copy:6-10'])
    const run = plan[1]
    assert.equal(run.kind, 'recode')
    if (run.kind === 'recode') {
      assert.deepEqual(
        run.parts.map((p) => [p.reason, p.from, p.to]),
        [['edge', 2, 3.5], ['text', 3.5, 4.5], ['edge', 4.5, 6]],
      )
    }
  })

  it('recodes a clip with an active effect and ignores a zero-strength one', () => {
    const effect = { kind: 'grayscale' as const, amount: 1 }
    const dirty = planSelective(buildSegments([clip('a', 0, 10, effect)]), [], [keys(0, 2, 4)])
    assert.deepEqual(shape(dirty), ['recode:0-10'])
    const idle = planSelective(
      buildSegments([clip('a', 0, 10, { kind: 'grayscale', amount: 0 })]),
      [],
      [keys(0, 2, 4)],
    )
    assert.deepEqual(shape(idle), ['copy:0-10'])
  })

  it('recodes everything from a source that cannot be mixed in', () => {
    const analysis = { ...keys(0, 2, 4), copyable: false }
    const plan = planSelective(buildSegments([clip('a', 0, 10)]), [], [analysis])
    assert.deepEqual(shape(plan), ['recode:0-10'])
    assert.equal(summarizePlan(plan).byReason.source, 10)
  })

  it('does not copy less than one whole GOP', () => {
    const plan = planSelective(buildSegments([clip('a', 1, 3)]), [], [keys(0, 2, 4)])
    assert.deepEqual(shape(plan), ['recode:1-3'])
    assert.equal(summarizePlan(plan).byReason.edge, 2)
  })

  it('skips copy runs shorter than the threshold', () => {
    const plan = planSelective(
      buildSegments([clip('a', 0, 10)]),
      [text(2.5, 3.5)],
      [keys(0, 2, 4, 6, 8)],
      { minCopy: 3 },
    )
    assert.deepEqual(shape(plan), ['recode:0-4', 'copy:4-10'])
    assert.ok(summarizePlan(plan).byReason.short > 0)
  })

  it('recodes a clip that ends inside the last GOP of a longer file', () => {
    const plan = planSelective(buildSegments([clip('a', 0, 9)]), [], [keys(0, 2, 4, 6, 8)])
    assert.deepEqual(shape(plan), ['copy:0-8', 'recode:8-9'])
  })

  it('copies through the end of the stream when the clip reaches it', () => {
    const analysis = { keyframes: [0, 4], streamEnd: 7, copyable: true }
    const plan = planSelective(buildSegments([clip('a', 0, 7.0004)]), [], [analysis])
    assert.deepEqual(shape(plan), ['copy:0-7.0004'])
  })

  it('maps captions through the clip offsets on the timeline', () => {
    const segments = buildSegments([clip('a', 0, 6), clip('b', 2, 8)])
    const plan = planSelective(
      segments,
      [text(5, 8)],
      [
        { keyframes: [0, 2, 4], streamEnd: 6, copyable: true },
        { keyframes: [0, 2, 4, 6, 8], streamEnd: 10, copyable: true },
      ],
    )
    assert.deepEqual(shape(plan), ['copy:0-4', 'recode:4-6', 'recode:2-4', 'copy:4-8'].map((s) => s))
    assert.equal(plan[1].segment, 0)
    assert.equal(plan[2].segment, 1)
  })

  it('keeps pieces contiguous and complete for every clip', () => {
    const segments = buildSegments([clip('a', 0.7, 9.3), clip('b', 1, 6)])
    const plan = planSelective(
      segments,
      [text(1.2, 2.2), text(8, 11)],
      [keys(0, 2, 4, 6, 8), keys(0, 2, 4)],
    )
    for (let index = 0; index < segments.length; index++) {
      const mine = plan.filter((p) => p.segment === index)
      assert.ok(Math.abs(mine[0].from - segments[index].start) < 1e-9)
      assert.ok(Math.abs(mine[mine.length - 1].to - segments[index].end) < 1e-9)
      for (let i = 1; i < mine.length; i++) assert.ok(Math.abs(mine[i].from - mine[i - 1].to) < 1e-9)
    }
    const summary = summarizePlan(plan)
    assert.ok(Math.abs(summary.copySeconds + summary.recodeSeconds - (8.6 + 5)) < 1e-9)
  })
})

describe('copyBlocker', () => {
  const target = {
    codec: 'vp9',
    codecString: 'vp09.00.41.08',
    description: null,
    width: 640,
    height: 360,
  }
  const source = {
    codec: 'vp9',
    codecString: 'vp09.00.31.08',
    description: null,
    width: 640,
    height: 360,
    rotation: 0,
  }

  it('accepts the same VP9 profile and depth at another level', () => {
    assert.equal(copyBlocker(source, target), null)
  })

  it('names the first difference', () => {
    assert.equal(copyBlocker(null, target), 'no-video')
    assert.equal(copyBlocker({ ...source, codec: 'avc' }, target), 'codec')
    assert.equal(copyBlocker({ ...source, rotation: 90 }, target), 'rotation')
    assert.equal(copyBlocker({ ...source, width: 641 }, target), 'size')
    assert.equal(copyBlocker({ ...source, codecString: 'vp09.02.31.10' }, target), 'params')
  })

  it('lets H.264 parameter sets differ but not the NAL length field', () => {
    const high = bytes(STREAMS.cabac.description)
    const base = bytes(STREAMS.cavlc.description)
    const avc = { ...target, codec: 'avc', codecString: 'avc1.640028', description: high }
    const other = { ...source, codec: 'avc', codecString: 'avc1.64001f' }
    assert.equal(copyBlocker({ ...other, description: base }, avc), null)
    const config = parseAvcConfig(base)!
    const narrow = avcC(config.sps.map((unit) => [...unit]), config.pps.map((unit) => [...unit]), 2)
    assert.equal(copyBlocker({ ...other, description: narrow }, avc), 'params')
    assert.equal(copyBlocker({ ...other, description: Uint8Array.of(1, 2, 3) }, avc), 'params')
    assert.equal(copyBlocker({ ...other, description: null }, avc), 'params')
  })
})

describe('copyBlocker colour', () => {
  const target = {
    codec: 'vp9',
    codecString: 'vp09.00.41.08',
    description: null,
    width: 640,
    height: 360,
    color: { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false },
  }
  const source = {
    codec: 'vp9',
    codecString: 'vp09.00.31.08',
    description: null,
    width: 640,
    height: 360,
    rotation: 0,
  }

  it('lets a source that states no colours through', () => {
    assert.equal(copyBlocker(source, target), null)
    assert.equal(copyBlocker({ ...source, color: {} }, target), null)
    assert.equal(copyBlocker({ ...source, color: { primaries: 'bt709' } }, { ...target, color: null }), null)
  })

  it('accepts matching colours', () => {
    assert.equal(copyBlocker({ ...source, color: { ...target.color } }, target), null)
  })

  it('refuses a stated difference in matrix or range', () => {
    assert.equal(copyBlocker({ ...source, color: { matrix: 'bt709' } }, target), 'color')
    assert.equal(copyBlocker({ ...source, color: { matrix: 'rgb' } }, target), 'color')
    assert.equal(copyBlocker({ ...source, color: { fullRange: true } }, target), 'color')
  })

  it('treats the two 601 matrices as one', () => {
    assert.equal(copyBlocker({ ...source, color: { matrix: 'bt470bg', fullRange: false } }, target), null)
  })

  it('does not hold primaries or transfer against a stream', () => {
    const color = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'smpte170m', fullRange: false }
    assert.equal(copyBlocker({ ...source, color }, target), null)
  })
})

describe('isClosedGop', () => {
  it('accepts frames inside the key frame window', () => {
    assert.equal(isClosedGop([2, 2.03, 2.07, 2.9], 2, 3), true)
  })

  it('refuses a frame shown before its key frame or after the next one', () => {
    assert.equal(isClosedGop([2, 1.97, 2.03], 2, 3), false)
    assert.equal(isClosedGop([2, 3.03], 2, 3), false)
  })

  it('lets the last GOP run to the end of the stream', () => {
    assert.equal(isClosedGop([6, 6.5, 9.9], 6, Infinity), true)
  })
})

describe('copyBlockers', () => {
  const target = {
    codec: 'avc',
    codecString: 'avc1.640028',
    description: bytes(STREAMS.cabac.description),
    width: 640,
    height: 360,
    color: { matrix: 'rgb', fullRange: true },
  }
  const source = {
    codec: 'avc',
    codecString: 'avc1.64001f',
    description: bytes(STREAMS.cavlc.description),
    width: 640,
    height: 360,
    rotation: 0,
    color: { matrix: 'bt709', fullRange: false },
  }

  it('lists every reason, in a fixed order', () => {
    assert.deepEqual(copyBlockers(source, target), ['color'])
    assert.deepEqual(copyBlockers({ ...source, width: 1, description: null }, target), ['size', 'color', 'params'])
    assert.deepEqual(copyBlockers(source, target, { ignoreColor: true }), [])
  })

  it('stops at a missing track or a different codec', () => {
    assert.deepEqual(copyBlockers(null, target), ['no-video'])
    assert.deepEqual(copyBlockers({ ...source, codec: 'vp9' }, target), ['codec'])
  })

  it('is empty for a copyable stream and agrees with copyBlocker', () => {
    const same = { ...source, color: null }
    assert.deepEqual(copyBlockers(same, target), [])
    assert.equal(copyBlocker(source, target), 'color')
  })
})
