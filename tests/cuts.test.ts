// tests/cuts.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Cutter, stretchOf } from '../src/resume/cuts.ts'
import type { Span } from '../src/resume/cuts.ts'

interface Part extends Span {
  frames: number[]
}

// What the export loop does with the cutter, on a list of frame times.
function partition(times: number[], seconds: number, total: number, covered = 0): Part[] {
  const cutter = new Cutter(seconds, total, covered)
  const parts: Part[] = []
  let current: Part | null = null
  for (const [index, time] of times.entries()) {
    let action = cutter.classify(time)
    if (action === 'skip') continue
    if (action === 'cut') {
      const span = cutter.close(false)
      Object.assign(current as Part, span)
      parts.push(current as Part)
      current = null
      action = 'start'
    }
    if (action === 'start') {
      const span = cutter.start(time)
      current = { ...span, frames: [] }
    }
    ;(current as Part).frames.push(index)
  }
  if (current) {
    Object.assign(current, cutter.close(true))
    parts.push(current)
  }
  return parts
}

const frames = (count: number, fps: number, from = 0) =>
  Array.from({ length: count }, (_, i) => from + i / fps)

describe('stretchOf', () => {
  it('numbers the stretches of the grid', () => {
    assert.equal(stretchOf(0, 30), 0)
    assert.equal(stretchOf(29.9, 30), 0)
    assert.equal(stretchOf(30, 30), 1)
    assert.equal(stretchOf(95, 30), 3)
  })

  it('counts a moment a hair short of a boundary as on it', () => {
    assert.equal(stretchOf(30 - 1e-12, 30), 1)
    assert.equal(stretchOf(30 - 1e-3, 30), 0)
  })
})

describe('Cutter', () => {
  it('cuts at the grid and ends the last part at the end of the timeline', () => {
    const times = frames(100, 10)
    const parts = partition(times, 3, 10)
    assert.deepEqual(
      parts.map(({ from, to, frames: list }) => [from, to, list.length]),
      [
        [0, 3, 30],
        [3, 6, 30],
        [6, 9, 30],
        [9, 10, 10],
      ],
    )
  })

  it('keeps every frame in exactly one part', () => {
    const times = frames(250, 25)
    const parts = partition(times, 4, 10)
    assert.deepEqual(parts.flatMap((part) => part.frames), times.map((_, index) => index))
  })

  it('puts a frame a hair short of a boundary into the part after it', () => {
    const times = [0, 1, 2, 3 - 1e-12, 4]
    const parts = partition(times, 3, 5)
    assert.deepEqual(parts.map((part) => part.frames), [[0, 1, 2], [3, 4]])
  })

  it('covers a stretch without frames with the part that follows the gap', () => {
    const times = [0, 1, 2, 20, 21]
    const parts = partition(times, 5, 22)
    assert.deepEqual(
      parts.map(({ from, to, frames: list }) => [from, to, list]),
      [
        [0, 5, [0, 1, 2]],
        [5, 22, [3, 4]],
      ],
    )
  })

  it('lets the last part reach the end of the timeline when the frames stop early', () => {
    const parts = partition(frames(20, 10), 5, 12)
    assert.deepEqual(parts.map(({ from, to }) => [from, to]), [[0, 12]])
  })

  it('starts every part where the one before ended', () => {
    const parts = partition(frames(400, 20), 4, 20)
    for (let i = 1; i < parts.length; i++) assert.equal(parts[i].from, parts[i - 1].to)
    assert.equal(parts[0].from, 0)
    assert.equal(parts[parts.length - 1].to, 20)
  })

  it('goes on from a part of the journal with the cuts an uninterrupted run makes', () => {
    const times = [...frames(180, 30), ...frames(150, 24, 6), ...frames(90, 60, 12.25)]
    times.sort((a, b) => a - b)
    const total = 13.75
    for (const seconds of [1, 2.5, 4, 30]) {
      const whole = partition(times, seconds, total)
      for (let k = 0; k < whole.length; k++) {
        const covered = whole[k].to
        const rest = partition(times, seconds, total, covered)
        const expected = whole.slice(k + 1)
        assert.deepEqual(rest, expected, `seconds ${seconds}, after part ${k}`)
      }
    }
  })

  it('has nothing left to do once the journal reaches the end', () => {
    const times = frames(100, 10)
    assert.deepEqual(partition(times, 3, 10, 10), [])
  })

  it('refuses a part length that is not positive', () => {
    assert.throws(() => new Cutter(0, 10))
  })

  it('refuses to open a part twice or to close none', () => {
    const cutter = new Cutter(5, 10)
    assert.throws(() => cutter.close(false))
    cutter.start(0)
    assert.throws(() => cutter.start(1))
  })
})
