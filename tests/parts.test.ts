// tests/parts.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { EncodedPacket, VideoSample } from 'mediabunny'
import type { Segment } from '../src/export/plan.ts'
import type { FrameItem, PacketItem, VideoItem } from '../src/export/videoItems.ts'
import { readManifest, writeWhole } from '../src/resume/journal.ts'
import { keepSegments, newManifest, resumeTime, segmentFile } from '../src/resume/manifest.ts'
import type { Manifest } from '../src/resume/manifest.ts'
import { readPacketFile } from '../src/resume/packetFile.ts'
import { runParts } from '../src/resume/parts.ts'
import type { Emit, Engine, PartsArgs } from '../src/resume/parts.ts'
import { memoryStore } from '../src/resume/store.ts'
import type { JournalStore } from '../src/resume/store.ts'

const COPIED = 2
const ENCODED = 1
const CONFIG = { codec: 'fake' }

type Unit = { kind: 'copy' | 'recode'; from: number; to: number }

// Times are counted in tenths of a second so that they stay exact.
const sec = (tenths: number) => tenths / 10

interface World {
  total: number
  items: VideoItem[]
  // For a copied packet: where its GOP ends.
  gopEnd: Map<VideoItem, number>
  closed: { count: number }
  // Frames handed to the loop.
  given: { count: number }
}

function packet(code: number, key: boolean, time: number, duration: number): EncodedPacket {
  return { type: key ? 'key' : 'delta', timestamp: time, duration, data: new Uint8Array([code]) } as unknown as EncodedPacket
}

// A timeline made of stretches that are copied (in GOPs of 2.5 s) and stretches
// that are decoded frame by frame.
function world(units: Unit[], gop = 25): World {
  const total = units[units.length - 1].to
  const segment = { clip: {}, start: 0, end: total, offset: 0, length: total } as unknown as Segment
  const closed = { count: 0 }
  const given = { count: 0 }
  const items: VideoItem[] = []
  const gopEnd = new Map<VideoItem, number>()
  for (const unit of units) {
    const from = Math.round(unit.from * 10)
    const to = Math.round(unit.to * 10)
    if (unit.kind === 'recode') {
      for (let t = from; t < to; t++) {
        const sample = { duration: 0.1, timestamp: sec(t), close: () => closed.count++ } as unknown as VideoSample
        items.push({ kind: 'frame', time: sec(t), sample, segment } satisfies FrameItem)
      }
      continue
    }
    for (let start = from; start < to; start += gop) {
      const end = Math.min(start + gop, to)
      for (let t = start; t < end; t++) {
        const item = { kind: 'packet', time: sec(t), packet: packet(COPIED, t === start, sec(t), 0.1) } satisfies PacketItem
        items.push(item)
        gopEnd.set(item, sec(end))
      }
    }
  }
  return { total, items, gopEnd, closed, given }
}

// What the reader of the items does when it goes on from `from`: the items
// that end before it are not read; the ones around it are.
async function* itemsFrom(w: World, from: number): AsyncGenerator<VideoItem> {
  for (const item of w.items) {
    if (item.kind === 'frame') {
      if (item.time >= from - 0.25) {
        w.given.count++
        yield item
      } else {
        item.sample.close()
      }
    } else if ((w.gopEnd.get(item) ?? 0) > from) {
      yield item
    }
  }
}

interface Spy {
  sessions: number
  accepted: { first: boolean; known: boolean }[]
}

// An encoder that gives out its packets only when the session is closed, the
// first of them a key packet: the worst case for the order of writing.
function fakeEngine(spy: Spy, onAdd?: (count: number) => void): Engine {
  let added = 0
  return {
    async open(emit: Emit) {
      spy.sessions++
      const frames: { time: number; duration: number }[] = []
      return {
        async add(item, duration) {
          onAdd?.(++added)
          frames.push({ time: item.time, duration })
        },
        async end() {
          frames.forEach((frame, i) =>
            emit(packet(ENCODED, i === 0, frame.time, frame.duration), { decoderConfig: CONFIG } as unknown as EncodedVideoChunkMetadata),
          )
          frames.length = 0
        },
        async cancel() {},
      }
    },
  }
}

const empty = (total: number, seconds: number): Manifest =>
  newManifest({ job: 'job', fingerprint: 'f', total, segmentSeconds: seconds, recipe: null, hasAudio: false, now: 1 })

function args(store: JournalStore, manifest: Manifest, items: AsyncIterable<VideoItem>, spy: Spy, over: Partial<PartsArgs> = {}): PartsArgs {
  return {
    store,
    manifest,
    items,
    engine: fakeEngine(spy),
    config: null,
    accept: (moved, _meta, first, known) => {
      spy.accepted.push({ first, known: known !== null })
      return moved
    },
    ...over,
  }
}

const newSpy = (): Spy => ({ sessions: 0, accepted: [] })

async function packetsOf(store: JournalStore, manifest: Manifest) {
  const parts = []
  for (const record of manifest.segments) {
    const bytes = await store.read(record.file)
    assert.ok(bytes, record.file)
    parts.push(readPacketFile(bytes).packets)
  }
  return parts
}

const label = (p: { data: Uint8Array; key: boolean; timestamp: number }) =>
  `${p.data[0] === COPIED ? 'c' : 'e'}${p.key ? 'K' : 'd'}@${p.timestamp.toFixed(1)}`

const MIXED: Unit[] = [
  { kind: 'copy', from: 0, to: 12 },
  { kind: 'recode', from: 12, to: 17 },
  { kind: 'copy', from: 17, to: 30 },
  { kind: 'recode', from: 30, to: 31 },
]

describe('runParts', () => {
  it('cuts a mixed timeline into contiguous parts that hold everything once, in order', async () => {
    const w = world(MIXED)
    const store = memoryStore()
    const spy = newSpy()
    const result = await runParts(args(store, empty(w.total, 5), itemsFrom(w, 0), spy))
    const { manifest } = result

    assert.equal(manifest.segments[0].from, 0)
    manifest.segments.forEach((record, i) => {
      if (i > 0) assert.equal(record.from, manifest.segments[i - 1].to)
      assert.ok(record.to > record.from)
    })
    assert.equal(resumeTime(manifest), w.total)
    for (const record of manifest.segments.slice(0, -1)) assert.equal(record.to % 5, 0)

    const parts = await packetsOf(store, manifest)
    for (const part of parts) assert.equal(part[0].key, true)
    const all = parts.flat()
    const times = all.map((p) => p.timestamp)
    assert.deepEqual(times, [...times].sort((a, b) => a - b))
    assert.deepEqual(times, w.items.map((item) => item.time))
    assert.equal(result.copiedPackets + result.frames, w.items.length)
    assert.equal(w.closed.count, w.items.filter((i) => i.kind === 'frame').length)
  })

  it('never writes a session’s packets after the copied packet that follows it', async () => {
    const w = world([
      { kind: 'recode', from: 0, to: 3 },
      { kind: 'copy', from: 3, to: 9 },
      { kind: 'recode', from: 9, to: 12 },
      { kind: 'copy', from: 12, to: 20 },
    ])
    const store = memoryStore()
    const { manifest } = await runParts(args(store, empty(w.total, 100), itemsFrom(w, 0), newSpy()))
    assert.equal(manifest.segments.length, 1)
    const [part] = await packetsOf(store, manifest)
    assert.deepEqual(
      part.map((p) => p.timestamp),
      w.items.map((i) => i.time),
    )
    assert.equal(part.filter((p) => p.data[0] === ENCODED && p.key).length, 2)
  })

  it('records how much of a part was copied', async () => {
    const w = world(MIXED)
    const { manifest } = await runParts(args(memoryStore(), empty(w.total, 5), itemsFrom(w, 0), newSpy()))
    const copied = manifest.segments.reduce((sum, r) => sum + (r.copied?.packets ?? 0), 0)
    assert.equal(copied, w.items.filter((i) => i.kind === 'packet').length)
    assert.ok(manifest.segments.some((r) => r.copied === undefined))
    const seconds = manifest.segments.reduce((sum, r) => sum + (r.copied?.seconds ?? 0), 0)
    assert.ok(Math.abs(seconds - 25) < 1e-6)
  })

  it('opens no encoder session for a timeline that is only copied', async () => {
    const w = world([{ kind: 'copy', from: 0, to: 40 }])
    const spy = newSpy()
    const { manifest, sessions } = await runParts(args(memoryStore(), empty(w.total, 10), itemsFrom(w, 0), spy))
    assert.equal(sessions, 0)
    assert.equal(spy.sessions, 0)
    assert.ok(manifest.segments.length >= 4)
    assert.equal(manifest.videoConfig, null)
  })

  it('goes on from any part exactly as an export that never stopped', async () => {
    for (const [units, seconds] of [
      [MIXED, 5],
      [MIXED, 3],
      [MIXED, 30],
      [[{ kind: 'copy', from: 0, to: 40 }] as Unit[], 7],
      [[{ kind: 'recode', from: 0, to: 20 }, { kind: 'copy', from: 20, to: 33 }] as Unit[], 4],
    ] as [Unit[], number][]) {
      const w = world(units)
      const whole = memoryStore()
      const reference = (await runParts(args(whole, empty(w.total, seconds), itemsFrom(w, 0), newSpy()))).manifest
      const referenceParts = (await packetsOf(whole, reference)).map((part) => part.map(label))

      for (let kept = 0; kept < reference.segments.length; kept++) {
        const store = memoryStore()
        for (const record of reference.segments.slice(0, kept)) {
          await writeWhole(store, record.file, [(await whole.read(record.file)) as Uint8Array])
        }
        const manifest = { ...keepSegments(reference, kept), videoConfig: kept === 0 ? null : reference.videoConfig }
        const resumed = await runParts(
          args(store, manifest, itemsFrom(w, resumeTime(manifest)), newSpy()),
        )
        assert.deepEqual(
          resumed.manifest.segments.map(({ from, to, packets, bytes, crc, copied }) => ({ from, to, packets, bytes, crc, copied })),
          reference.segments.map(({ from, to, packets, bytes, crc, copied }) => ({ from, to, packets, bytes, crc, copied })),
          `${seconds} s, ${kept} parts kept`,
        )
        assert.deepEqual((await packetsOf(store, resumed.manifest)).map((part) => part.map(label)), referenceParts)
      }
    }
  })

  it('closes every frame it was given, the ones it skips and the ones after a failure', async () => {
    const w = world(MIXED)
    const first = (await runParts(args(memoryStore(), empty(w.total, 5), itemsFrom(w, 0), newSpy()))).manifest
    const frames = w.items.filter((i) => i.kind === 'frame').length
    w.closed.count = 0
    const store = memoryStore()
    for (const record of first.segments.slice(0, 3)) {
      await writeWhole(store, record.file, [new Uint8Array(1)])
    }
    const resumed = keepSegments(first, 3)
    await runParts(args(store, { ...resumed, complete: false }, itemsFrom(w, resumeTime(resumed)), newSpy()))
    assert.equal(w.closed.count, frames)

    const again = world(MIXED)
    const spy = newSpy()
    await assert.rejects(
      runParts(
        args(memoryStore(), empty(again.total, 5), itemsFrom(again, 0), spy, {
          accept: (p) => {
            if (spy.accepted.push({ first: false, known: false }) === 4) throw new Error('bad packet')
            return p
          },
        }),
      ),
      /bad packet/,
    )
    assert.ok(again.given.count > 0 && again.given.count < again.items.filter((i) => i.kind === 'frame').length)
    assert.equal(again.closed.count, again.given.count)
  })

  it('keeps the parts it committed and nothing of the one it was writing when it is aborted', async () => {
    const w = world(MIXED)
    const store = memoryStore()
    const controller = new AbortController()
    const spy = newSpy()
    const run = runParts(
      args(store, empty(w.total, 5), itemsFrom(w, 0), spy, {
        engine: fakeEngine(spy, (count) => {
          if (count === 30) controller.abort()
        }),
        signal: controller.signal,
      }),
    )
    await assert.rejects(run, (error: Error) => error.name === 'AbortError')
    const manifest = await readManifest(store)
    assert.ok(manifest)
    assert.ok(manifest.segments.length > 0 && !manifest.complete)
    assert.deepEqual(
      (await store.list()).filter((name) => name.endsWith('.tzs')).sort(),
      manifest.segments.map((record) => record.file),
    )
    assert.equal((await store.read(segmentFile(manifest.segments.length))) === null, true)
  })

  it('learns the stream from the first packet, or takes it as given', async () => {
    const w = world([{ kind: 'recode', from: 0, to: 12 }])
    const spy = newSpy()
    const learned = await runParts(args(memoryStore(), empty(w.total, 5), itemsFrom(w, 0), spy))
    assert.deepEqual(learned.manifest.videoConfig, CONFIG)
    assert.deepEqual(spy.accepted.filter((a) => a.first).map((a) => a.known), [false, true, true])
    assert.equal(spy.accepted.filter((a) => a.first).length, spy.sessions)

    const w2 = world([{ kind: 'recode', from: 0, to: 12 }])
    const given = await runParts(args(memoryStore(), empty(w2.total, 5), itemsFrom(w2, 0), newSpy(), { config: { codec: 'given' } }))
    assert.deepEqual(given.manifest.videoConfig, { codec: 'given' })
  })

  it('drops a frame that has no time left in the timeline', async () => {
    const w = world([{ kind: 'recode', from: 0, to: 2 }])
    const last = w.items[w.items.length - 1] as FrameItem
    const tail: FrameItem = { ...last, time: w.total - 1e-6 }
    w.items.push(tail)
    const { manifest, frames } = await runParts(args(memoryStore(), empty(w.total, 5), itemsFrom(w, 0), newSpy()))
    assert.equal(frames, 20)
    assert.equal(manifest.segments[0].packets, 20)
  })

  it('returns at once when the journal already covers the timeline', async () => {
    const w = world([{ kind: 'recode', from: 0, to: 4 }])
    const store = memoryStore()
    const done = (await runParts(args(store, empty(w.total, 5), itemsFrom(w, 0), newSpy()))).manifest
    const spy = newSpy()
    const result = await runParts(args(store, done, itemsFrom(w, w.total), spy))
    assert.equal(result.frames, 0)
    assert.equal(spy.sessions, 0)
    assert.equal(result.manifest.segments.length, done.segments.length)
  })
})
