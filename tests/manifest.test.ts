// tests/manifest.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JournalCorrupt } from '../src/resume/corrupt.ts'
import {
  AUDIO_FILE,
  keepSegments,
  newManifest,
  parseManifest,
  resumeTime,
  segmentFile,
  serializeManifest,
  withAudio,
  withComplete,
  withSegment,
  withVideoConfig,
} from '../src/resume/manifest.ts'
import type { Manifest, SegmentRecord } from '../src/resume/manifest.ts'

const fresh = (hasAudio = true): Manifest =>
  newManifest({ job: 'job-1', fingerprint: 'abc', total: 100, segmentSeconds: 30, recipe: null, hasAudio, now: 1000 })

const segment = (index: number, from: number, to: number): SegmentRecord => ({
  index,
  file: segmentFile(index),
  from,
  to,
  packets: 10,
  bytes: 500,
  crc: 12345,
})

describe('manifest', () => {
  it('starts empty, with the sound pending when the project has some', () => {
    const manifest = fresh()
    assert.equal(manifest.segments.length, 0)
    assert.equal(manifest.audioState, 'pending')
    assert.equal(fresh(false).audioState, 'none')
    assert.equal(resumeTime(manifest), 0)
    assert.equal(manifest.complete, false)
  })

  it('names the segment files by number, in order', () => {
    assert.equal(segmentFile(0), 'video-000000.tzs')
    assert.equal(segmentFile(42), 'video-000042.tzs')
    assert.ok(segmentFile(9) < segmentFile(10))
  })

  it('adds segments that follow each other, and goes on from the end of the last', () => {
    let manifest = fresh()
    manifest = withSegment(manifest, segment(0, 0, 30), 1001)
    manifest = withSegment(manifest, segment(1, 30, 61.5), 1002)
    assert.equal(manifest.segments.length, 2)
    assert.equal(resumeTime(manifest), 61.5)
    assert.equal(manifest.updated, 1002)
  })

  it('does not change the manifest it was given', () => {
    const before = fresh()
    withSegment(before, segment(0, 0, 30), 1001)
    assert.equal(before.segments.length, 0)
  })

  it('refuses a segment out of order, with a gap, or of no length', () => {
    const one = withSegment(fresh(), segment(0, 0, 30), 1)
    assert.throws(() => withSegment(one, segment(2, 30, 60), 2), /Номер/)
    assert.throws(() => withSegment(one, segment(1, 31, 60), 2), /не стикується/)
    assert.throws(() => withSegment(one, segment(1, 30, 30), 2), /нульову/)
    assert.throws(() => withSegment(fresh(), segment(0, 5, 30), 1), /не стикується/)
  })

  it('records the sound and the configs', () => {
    let manifest = withVideoConfig(fresh(), { codec: 'vp09.00.10.08' }, 5)
    manifest = withAudio(manifest, { file: AUDIO_FILE, packets: 100, bytes: 9000, crc: 7 }, { codec: 'opus' }, 6)
    assert.equal(manifest.audioState, 'done')
    assert.equal(manifest.audio?.file, AUDIO_FILE)
    assert.equal(manifest.videoConfig?.codec, 'vp09.00.10.08')
    assert.equal(withComplete(manifest, 7).complete, true)
  })

  it('keeps the first segments only, and no longer counts as complete', () => {
    let manifest = fresh()
    manifest = withSegment(manifest, segment(0, 0, 40), 1)
    manifest = withSegment(manifest, segment(1, 40, 100), 2)
    manifest = withComplete(manifest, 3)
    const cut = keepSegments(manifest, 1)
    assert.equal(cut.segments.length, 1)
    assert.equal(cut.complete, false)
    assert.equal(resumeTime(cut), 40)
    assert.equal(keepSegments(manifest, 5), manifest)
    assert.equal(keepSegments(manifest, 0).segments.length, 0)
  })

  it('goes through text and back unchanged', () => {
    let manifest = fresh()
    manifest = withVideoConfig(manifest, { codec: 'avc1.64001f', description: 'AQID' }, 2)
    manifest = withSegment(manifest, segment(0, 0, 30), 3)
    manifest = withAudio(manifest, { file: AUDIO_FILE, packets: 3, bytes: 99, crc: 1 }, { codec: 'mp4a.40.2' }, 4)
    assert.deepEqual(parseManifest(serializeManifest(manifest)), manifest)
  })

  it('keeps what a segment copied, and reads a segment that says nothing of it', () => {
    let manifest = withSegment(fresh(), { ...segment(0, 0, 30), copied: { packets: 4, seconds: 1.5 } }, 2)
    manifest = withSegment(manifest, segment(1, 30, 60), 3)
    const back = parseManifest(serializeManifest(manifest))
    assert.deepEqual(back, manifest)
    assert.deepEqual(back.segments[0].copied, { packets: 4, seconds: 1.5 })
    assert.equal('copied' in back.segments[1], false)

    const text = JSON.parse(serializeManifest(manifest))
    text.segments[0].copied = { packets: 'many' }
    assert.equal(parseManifest(JSON.stringify(text)).segments[0].copied, undefined)
  })

  it('refuses text that is not a manifest, or of another version', () => {
    assert.throws(() => parseManifest('not json'), JournalCorrupt)
    assert.throws(() => parseManifest('[]'), JournalCorrupt)
    assert.throws(() => parseManifest('{}'), /версія/)
    const other = JSON.parse(serializeManifest(fresh()))
    other.version = 99
    assert.throws(() => parseManifest(JSON.stringify(other)), /версія/)
  })

  it('refuses a manifest whose fields are missing or of the wrong kind', () => {
    const base = JSON.parse(serializeManifest(fresh()))
    for (const [key, value] of [
      ['job', 5],
      ['fingerprint', null],
      ['total', 'long'],
      ['segmentSeconds', Infinity],
      ['audioState', 'maybe'],
      ['segments', {}],
      ['complete', 1],
    ] as const) {
      const bad = { ...base, [key]: value }
      assert.throws(() => parseManifest(JSON.stringify(bad)), JournalCorrupt, key)
    }
  })

  it('refuses segments that do not follow each other', () => {
    const manifest = JSON.parse(
      serializeManifest(withSegment(withSegment(fresh(), segment(0, 0, 30), 1), segment(1, 30, 60), 2)),
    )
    const gap = structuredClone(manifest)
    gap.segments[1].from = 31
    assert.throws(() => parseManifest(JSON.stringify(gap)), /не стикуються/)
    const number = structuredClone(manifest)
    number.segments[1].index = 5
    assert.throws(() => parseManifest(JSON.stringify(number)), JournalCorrupt)
    const missing = structuredClone(manifest)
    delete missing.segments[0].crc
    assert.throws(() => parseManifest(JSON.stringify(missing)), JournalCorrupt)
  })

  it('refuses a finished sound with no record of it', () => {
    const manifest = JSON.parse(serializeManifest(fresh()))
    manifest.audioState = 'done'
    assert.throws(() => parseManifest(JSON.stringify(manifest)), /звуку/)
  })
})
