// tests/configs.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { configFromStored, configToStored, fromBase64, sameStream, toBase64 } from '../src/resume/configs.ts'

describe('stored configs', () => {
  it('turns bytes into text and back, whatever their length', () => {
    for (const length of [0, 1, 2, 3, 100, 0x8000, 0x8000 + 5, 70000]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31) & 255)
      assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes])
    }
  })

  it('keeps the description as base64 and everything else as it is', () => {
    const description = new Uint8Array([1, 2, 3, 250])
    const stored = configToStored({
      codec: 'avc1.64001f',
      codedWidth: 1280,
      codedHeight: 720,
      description,
      colorSpace: { primaries: 'bt709', fullRange: false },
      onChange: () => {},
      missing: undefined,
    })
    assert.equal(stored.codec, 'avc1.64001f')
    assert.equal(stored.description, toBase64(description))
    assert.deepEqual(stored.colorSpace, { primaries: 'bt709', fullRange: false })
    assert.ok(!('onChange' in stored) && !('missing' in stored))
    // The text survives being written to a file.
    const back = configFromStored<{ description: Uint8Array; codedWidth: number }>(JSON.parse(JSON.stringify(stored)))
    assert.deepEqual([...back.description], [1, 2, 3, 250])
    assert.equal(back.codedWidth, 1280)
  })

  it('takes a description that is a view into a bigger buffer, or an ArrayBuffer', () => {
    const big = new Uint8Array([9, 9, 5, 6, 7, 9])
    const view = big.subarray(2, 5)
    assert.deepEqual([...fromBase64(configToStored({ description: view }).description as string)], [5, 6, 7])
    const buffer = new Uint8Array([4, 4]).buffer
    assert.deepEqual([...fromBase64(configToStored({ description: buffer }).description as string)], [4, 4])
  })

  it('leaves a config without a description alone', () => {
    const back = configFromStored<{ sampleRate: number; description?: Uint8Array }>(
      configToStored({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }),
    )
    assert.equal(back.sampleRate, 48000)
    assert.equal(back.description, undefined)
  })
})

describe('sameStream', () => {
  it('accepts a config with the same codec and description', () => {
    const stored = configToStored({ codec: 'avc1.64001f', description: new Uint8Array([1, 2, 3]), codedWidth: 640 })
    assert.equal(sameStream(stored, { codec: 'avc1.64001f', description: new Uint8Array([1, 2, 3]).buffer, codedWidth: 640 }), true)
  })

  it('rejects another description or codec string', () => {
    const stored = configToStored({ codec: 'avc1.64001f', description: new Uint8Array([1, 2, 3]) })
    assert.equal(sameStream(stored, { codec: 'avc1.64001f', description: new Uint8Array([1, 2, 4]) }), false)
    assert.equal(sameStream(stored, { codec: 'avc1.640020', description: new Uint8Array([1, 2, 3]) }), false)
    assert.equal(sameStream(stored, { codec: 'avc1.64001f' }), false)
  })

  it('accepts a stream without a description', () => {
    const stored = configToStored({ codec: 'vp09.00.10.08' })
    assert.equal(sameStream(stored, { codec: 'vp09.00.10.08' }), true)
  })
})
