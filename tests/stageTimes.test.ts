// tests/stageTimes.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyStages, timedItems } from '../src/export/stageTimes.ts'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function source(count: number, delay: number) {
  const state = { returned: 0 }
  async function* items() {
    try {
      for (let i = 0; i < count; i++) {
        await sleep(delay)
        yield i
      }
    } finally {
      state.returned++
    }
  }
  return { state, items: items() }
}

describe('timedItems', () => {
  it('hands the items on in order and adds the time spent waiting for them', async () => {
    const stages = emptyStages()
    const { items } = source(3, 15)
    const seen: number[] = []
    for await (const item of timedItems(items, stages)) seen.push(item)
    assert.deepEqual(seen, [0, 1, 2])
    assert.ok(stages.waitMs >= 40, String(stages.waitMs))
    assert.equal(stages.composeMs, 0)
    assert.equal(stages.firstFrameMs, null)
  })

  it('ends the source when the reader stops early or fails, as a plain loop would', async () => {
    const early = source(5, 0)
    for await (const item of timedItems(early.items, emptyStages())) {
      if (item === 1) break
    }
    assert.equal(early.state.returned, 1)

    const failing = source(5, 0)
    await assert.rejects(async () => {
      for await (const item of timedItems(failing.items, emptyStages())) {
        if (item === 2) throw new Error('stop')
      }
    }, /stop/)
    assert.equal(failing.state.returned, 1)
  })

  it('passes on a failure of the source', async () => {
    async function* broken(): AsyncGenerator<number> {
      yield 1
      throw new Error('decoder')
    }
    await assert.rejects(async () => {
      for await (const _ of timedItems(broken(), emptyStages())) void _
    }, /decoder/)
  })
})
