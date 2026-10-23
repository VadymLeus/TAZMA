// tests/gifTicks.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tickCount, tickDelay, tickEnd, tickStart } from '../src/export/gifTicks.ts'

function delays(total: number, fps: number): number[] {
  const count = tickCount(total, fps)
  return Array.from({ length: count }, (_, i) => tickDelay(i, count, total, fps))
}

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)

describe('GIF ticks', () => {
  it('counts the frames of the grid and keeps at least one', () => {
    assert.equal(tickCount(2, 15), 30)
    assert.equal(tickCount(0.01, 15), 1)
    assert.equal(tickCount(1.02, 25), 26)
  })

  it('places tick starts evenly and ends the last one with the video', () => {
    assert.equal(tickStart(3, 10), 0.3)
    assert.equal(tickEnd(0, 4, 0.37, 10), 0.1)
    assert.equal(tickEnd(3, 4, 0.37, 10), 0.37)
  })

  it('gives whole hundredths that add up to the length', () => {
    for (const fps of [5, 10, 12, 15, 20, 25, 30]) {
      for (const total of [1, 2.5, 3.333, 7.07, 12.9]) {
        const list = delays(total, fps)
        assert.ok(list.every((d) => Number.isInteger(d) && d >= 2), `${fps} ${total}`)
        assert.ok(Math.abs(sum(list) - total * 100) <= 1.5, `${fps} ${total}: ${sum(list)}`)
      }
    }
  })

  it('spreads the rounding for rates that do not divide a hundredth', () => {
    const list = delays(1, 30)
    assert.equal(list.length, 30)
    assert.equal(sum(list), 100)
    assert.deepEqual([...new Set(list)].sort(), [3, 4])
  })

  it('never shortens a frame below two hundredths', () => {
    assert.equal(tickDelay(0, 1, 0.005, 15), 2)
  })
})
