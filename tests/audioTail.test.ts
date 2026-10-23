// tests/audioTail.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUDIO_TAIL_SLACK, failureAtTail } from '../src/export/audio.ts'

describe('failureAtTail', () => {
  it('lets a decoder fail at the very end of the clip', () => {
    assert.equal(failureAtTail(1228.8, 1228.9), true)
    assert.equal(failureAtTail(1228.9, 1228.9), true)
  })

  it('lets it fail within the slack before the end, and not before that', () => {
    assert.equal(failureAtTail(100 - AUDIO_TAIL_SLACK, 100), true)
    assert.equal(failureAtTail(100 - AUDIO_TAIL_SLACK - 0.01, 100), false)
    assert.equal(failureAtTail(3, 100), false)
  })

  it('does not let it fail before any sound was decoded', () => {
    assert.equal(failureAtTail(null, 1), false)
    assert.equal(failureAtTail(null, 100), false)
  })
})
