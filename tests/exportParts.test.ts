// tests/exportParts.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { silenceChunks, trimWindow } from '../src/export/audio.ts'
import { remixToStereo, resampleLinear } from '../src/export/audioFormat.ts'
import {
  GIF_DEFAULT_FPS,
  availableContainers,
  defaultSettings,
  exportFileName,
  normalizeSettings,
  withContainer,
} from '../src/export/settings.ts'
import { estimateRemaining, formatRemaining, resultSpeed } from '../src/export/stats.ts'
import { heightChoices, outputSize } from '../src/export/geometry.ts'
import { mergeByTime } from '../src/export/merge.ts'
import type { Timed } from '../src/export/merge.ts'
import { buildSegments } from '../src/export/plan.ts'
import type { Clip } from '../src/project/types.ts'

describe('outputSize', () => {
  it('keeps the frame and makes the sides even', () => {
    assert.deepEqual(outputSize({ width: 1921, height: 1081 }, null), { width: 1920, height: 1080 })
  })

  it('scales to a height and keeps the aspect ratio', () => {
    assert.deepEqual(outputSize({ width: 1920, height: 1080 }, 720), { width: 1280, height: 720 })
    assert.deepEqual(outputSize({ width: 1280, height: 960 }, 480), { width: 640, height: 480 })
    assert.deepEqual(outputSize({ width: 1080, height: 1920 }, 720), { width: 404, height: 720 })
  })
})

describe('heightChoices', () => {
  it('offers only smaller heights', () => {
    assert.deepEqual(heightChoices({ width: 1920, height: 1080 }), [720, 480, 360])
    assert.deepEqual(heightChoices({ width: 640, height: 360 }), [])
  })
})

describe('trimWindow', () => {
  const rate = 48000

  it('keeps a block that lies inside the clip, shifted to the offset', () => {
    const win = trimWindow(10, 4800, rate, 10, 20, 3)
    assert.deepEqual(win, { frameOffset: 0, frameCount: 4800, timestamp: 3 })
  })

  it('cuts the head of a block that starts before the clip', () => {
    const win = trimWindow(9.9, 9600, rate, 10, 20, 0)
    assert.ok(win)
    assert.equal(win.frameOffset, 4800)
    assert.equal(win.frameCount, 4800)
    assert.ok(Math.abs(win.timestamp) < 1e-9)
  })

  it('cuts the tail of a block that runs past the clip end', () => {
    const win = trimWindow(19.95, 4800, rate, 10, 20, 5)
    assert.ok(win)
    assert.equal(win.frameOffset, 0)
    assert.equal(win.frameCount, 2400)
    assert.ok(Math.abs(win.timestamp - (5 + 9.95)) < 1e-9)
  })

  it('drops blocks outside the clip', () => {
    assert.equal(trimWindow(20, 4800, rate, 10, 20, 0), null)
    assert.equal(trimWindow(9, 4800, rate, 10, 20, 0), null)
  })
})

describe('silenceChunks', () => {
  it('covers the range without gaps or overlaps', () => {
    const chunks = silenceChunks(1.25, 4.5, 48000)
    assert.equal(chunks.length, 4)
    let expected = Math.round(1.25 * 48000)
    for (const chunk of chunks) {
      assert.equal(Math.round(chunk.timestamp * 48000), expected)
      expected += chunk.frames
    }
    assert.equal(expected, Math.round(4.5 * 48000))
  })

  it('is empty for an empty range', () => {
    assert.deepEqual(silenceChunks(2, 2, 48000), [])
  })
})

describe('buildSegments', () => {
  it('places clips one after another', () => {
    const clips: Clip[] = [
      { id: 'a', sourceId: 's', start: 2, end: 5 },
      { id: 'b', sourceId: 't', start: 0, end: 1.5 },
    ]
    assert.deepEqual(
      buildSegments(clips).map((s) => [s.offset, s.length, s.start, s.end]),
      [
        [0, 3, 2, 5],
        [3, 1.5, 0, 1.5],
      ],
    )
  })
})

async function* stream(items: Timed[], log: string[], name: string): AsyncGenerator<Timed> {
  try {
    for (const item of items) yield item
  } finally {
    log.push(`closed ${name}`)
  }
}

describe('mergeByTime', () => {
  it('interleaves streams by time, ties go to the first stream', async () => {
    const log: string[] = []
    const video = stream([{ time: 0 }, { time: 1 }, { time: 2 }], log, 'v')
    const audio = stream([{ time: 0 }, { time: 0.5 }, { time: 1 }, { time: 1.5 }, { time: 2.5 }], log, 'a')
    const order: string[] = []
    const tagged = [
      (async function* () { for await (const i of video) yield { ...i, tag: 'v' } })(),
      (async function* () { for await (const i of audio) yield { ...i, tag: 'a' } })(),
    ]
    for await (const item of mergeByTime(tagged)) order.push(`${item.tag}${item.time}`)
    assert.deepEqual(order, ['v0', 'a0', 'a0.5', 'v1', 'a1', 'a1.5', 'v2', 'a2.5'])
    assert.deepEqual(log.sort(), ['closed a', 'closed v'])
  })

  it('closes every stream and disposes unyielded items when stopped early', async () => {
    const log: string[] = []
    const disposed: number[] = []
    const a = stream([{ time: 0 }, { time: 2 }], log, 'a')
    const b = stream([{ time: 1 }, { time: 3 }], log, 'b')
    for await (const item of mergeByTime([a, b], (i) => disposed.push(i.time))) {
      assert.equal(item.time, 0)
      break
    }
    assert.deepEqual(log.sort(), ['closed a', 'closed b'])
    assert.deepEqual(disposed, [1])
  })

  it('works with one empty stream', async () => {
    const log: string[] = []
    const items: number[] = []
    for await (const item of mergeByTime([stream([], log, 'x'), stream([{ time: 1 }], log, 'y')])) {
      items.push(item.time)
    }
    assert.deepEqual(items, [1])
  })
})

describe('remixToStereo', () => {
  it('doubles a mono channel', () => {
    const [l, r] = remixToStereo([Float32Array.of(0.5, -0.25)])
    assert.deepEqual([...l], [0.5, -0.25])
    assert.deepEqual([...r], [0.5, -0.25])
  })

  it('keeps stereo as is', () => {
    const [l, r] = remixToStereo([Float32Array.of(1, 2), Float32Array.of(3, 4)])
    assert.deepEqual([...l], [1, 2])
    assert.deepEqual([...r], [3, 4])
  })

  it('downmixes 5.1 without clipping a full-scale signal', () => {
    const one = Float32Array.of(1)
    const zero = Float32Array.of(0)
    const [l, r] = remixToStereo([one, zero, one, one, one, zero])
    assert.ok(l[0] > 0.9 && l[0] <= 1.01)
    assert.ok(r[0] > 0.2 && r[0] < 0.5)
  })

  it('averages other layouts', () => {
    const [l, r] = remixToStereo([Float32Array.of(1), Float32Array.of(0), Float32Array.of(1), Float32Array.of(0)])
    assert.equal(l[0], 1)
    assert.equal(r[0], 0)
  })
})

describe('resampleLinear', () => {
  it('returns the input for equal rates', () => {
    const input = Float32Array.of(1, 2, 3)
    assert.equal(resampleLinear(input, 48000, 48000), input)
  })

  it('changes the length by the rate ratio and keeps a constant level', () => {
    const output = resampleLinear(new Float32Array(441).fill(0.3), 44100, 48000)
    assert.equal(output.length, 480)
    assert.ok(output.every((v) => Math.abs(v - 0.3) < 1e-6))
  })

  it('keeps a ramp rising', () => {
    const ramp = Float32Array.from({ length: 100 }, (_, i) => i / 100)
    const output = resampleLinear(ramp, 44100, 48000)
    for (let i = 1; i < output.length; i++) assert.ok(output[i] >= output[i - 1] - 1e-9)
  })
})

const both = {
  mp4: { video: ['avc', 'vp9'], audio: ['aac', 'opus'] },
  webm: { video: ['vp9', 'av1'], audio: ['opus'] },
} as never

const noH264 = {
  mp4: { video: ['vp9'], audio: ['opus'] },
  webm: { video: ['vp9'], audio: ['opus'] },
} as never

describe('export settings', () => {
  it('keeps valid settings', () => {
    assert.deepEqual(normalizeSettings(defaultSettings, both, [720, 480]), defaultSettings)
  })

  it('falls back when H.264 and AAC are missing', () => {
    const result = normalizeSettings(defaultSettings, noH264, [])
    assert.equal(result.container, 'mp4')
    assert.equal(result.videoCodec, 'vp9')
    assert.equal(result.audioCodec, 'opus')
  })

  it('moves to another container when the chosen one cannot encode video', () => {
    const choices = {
      mp4: { video: [], audio: [] },
      webm: { video: ['vp9'], audio: ['opus'] },
    } as never
    assert.deepEqual(availableContainers(choices), ['webm', 'gif'])
    assert.equal(normalizeSettings(defaultSettings, choices, []).container, 'webm')
  })

  it('drops a height that is not offered', () => {
    const result = normalizeSettings({ ...defaultSettings, height: 1080 }, both, [720])
    assert.equal(result.height, null)
    assert.equal(normalizeSettings({ ...defaultSettings, height: 720 }, both, [720]).height, 720)
  })

  it('starts a new container from its preferred codecs', () => {
    const result = normalizeSettings(withContainer(defaultSettings, 'webm'), both, [])
    assert.equal(result.videoCodec, 'vp9')
    assert.equal(result.audioCodec, 'opus')
    const back = normalizeSettings(withContainer(result, 'mp4'), both, [])
    assert.equal(back.videoCodec, 'avc')
    assert.equal(back.audioCodec, 'aac')
  })

  it('names the file by container', () => {
    assert.equal(exportFileName('webm'), 'tazma-export.webm')
    assert.equal(exportFileName('gif'), 'tazma-export.gif')
  })

  it('offers GIF even when no video codec can be encoded', () => {
    const none = {
      mp4: { video: [], audio: [] },
      webm: { video: [], audio: [] },
    } as never
    assert.deepEqual(availableContainers(none), ['gif'])
    assert.equal(normalizeSettings(defaultSettings, none, []).container, 'gif')
  })

  it('keeps GIF settings and fixes a frame rate that is not offered', () => {
    const gif = withContainer(defaultSettings, 'gif')
    assert.equal(normalizeSettings(gif, both, []).container, 'gif')
    assert.equal(normalizeSettings({ ...gif, gifFps: 17 }, both, []).gifFps, GIF_DEFAULT_FPS)
    assert.equal(normalizeSettings({ ...gif, gifFps: 25 }, both, []).gifFps, 25)
  })

  it('starts GIF from a frame that is not too large', () => {
    const heights = [1080, 720, 480, 360]
    assert.equal(withContainer(defaultSettings, 'gif', heights).height, 480)
    assert.equal(withContainer({ ...defaultSettings, height: 360 }, 'gif', heights).height, 360)
    assert.equal(withContainer({ ...defaultSettings, height: 720 }, 'gif', heights).height, 480)
    assert.equal(withContainer(defaultSettings, 'gif', []).height, null)
    assert.equal(withContainer(defaultSettings, 'gif', [1080, 720]).height, null)
  })

  it('returns to the video codecs after GIF', () => {
    const back = withContainer(withContainer(defaultSettings, 'gif'), 'webm')
    assert.equal(back.container, 'webm')
    assert.equal(back.videoCodec, 'vp9')
  })
})

describe('export stats', () => {
  it('has no estimate without progress', () => {
    assert.equal(estimateRemaining(0, 10, 5000), null)
    assert.equal(estimateRemaining(2, 10, 100), null)
  })

  it('estimates the time left from the pace so far', () => {
    assert.equal(estimateRemaining(2, 10, 4000), 16)
    assert.equal(estimateRemaining(10, 10, 4000), 0)
  })

  it('formats the remaining time', () => {
    assert.equal(formatRemaining(0.2), '≈ 1 с')
    assert.equal(formatRemaining(41.2), '≈ 42 с')
    assert.equal(formatRemaining(120), '≈ 2 хв')
    assert.equal(formatRemaining(125), '≈ 2 хв 5 с')
  })

  it('computes speed', () => {
    const speed = resultSpeed({ frames: 190, duration: 7, elapsedMs: 1000 })
    assert.equal(speed.framesPerSecond, 190)
    assert.equal(speed.realtime, 7)
  })
})
