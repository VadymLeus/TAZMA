// tests/gifEncoder.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GifEncoder } from '../src/gif/gifEncoder.ts'
import type { GifOptions } from '../src/gif/gifEncoder.ts'
import { LzwEncoder } from '../src/gif/lzw.ts'
import { Mapper, buildPalette } from '../src/gif/quantize.ts'
import { decodeGif, lzwDecode } from './gifDecode.ts'

function random(seed: number) {
  let state = seed >>> 0
  return (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % limit
  }
}

function encode(frames: { rgba: Uint8Array; delay: number }[], options: Partial<GifOptions> & { width: number; height: number }) {
  const chunks: Uint8Array[] = []
  const encoder = new GifEncoder({ loop: 0, dither: false, tolerance: 0, ...options }, (chunk) => chunks.push(chunk))
  for (const frame of frames) encoder.addFrame(frame.rgba, frame.delay)
  encoder.finish()
  let size = 0
  for (const chunk of chunks) size += chunk.length
  const bytes = new Uint8Array(size)
  let pos = 0
  for (const chunk of chunks) {
    bytes.set(chunk, pos)
    pos += chunk.length
  }
  return bytes
}

function solid(width: number, height: number, color: [number, number, number]) {
  const rgba = new Uint8Array(width * height * 4)
  for (let at = 0; at < width * height; at++) rgba.set([...color, 255], at * 4)
  return rgba
}

function psnr(a: Uint8Array, b: Uint8Array) {
  let sum = 0
  let count = 0
  for (let at = 0; at < a.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const d = (a[at + channel] as number) - (b[at + channel] as number)
      sum += d * d
      count++
    }
  }
  return sum === 0 ? 99 : 10 * Math.log10((255 * 255) / (sum / count))
}

describe('LzwEncoder', () => {
  const lzw = new LzwEncoder()

  it('round trips data of many shapes and bit depths', () => {
    const next = random(5)
    for (let depth = 2; depth <= 8; depth++) {
      const range = 1 << depth
      const shapes: Uint8Array[] = [
        Uint8Array.of(0),
        Uint8Array.of(range - 1, 0),
        new Uint8Array(70_000),
        Uint8Array.from({ length: 300 }, (_, at) => at % range),
        Uint8Array.from({ length: 100_000 }, () => next(range)),
        Uint8Array.from({ length: 50_000 }, (_, at) => ((at >> 3) * 7) % range),
      ]
      for (const data of shapes) {
        const packed = lzw.encode(data, depth)
        assert.deepEqual([...lzwDecode(packed, depth, data.length)], [...data], `depth ${depth}, ${data.length} values`)
      }
    }
  })

  it('shortens repetitive data', () => {
    assert.ok(lzw.encode(new Uint8Array(10_000), 2).length < 200)
  })

  it('can be used again after any frame', () => {
    const a = Uint8Array.from({ length: 9000 }, (_, at) => (at * 31) % 16)
    const b = Uint8Array.from({ length: 50 }, (_, at) => at % 4)
    for (let round = 0; round < 3; round++) {
      assert.deepEqual([...lzwDecode(lzw.encode(a, 4), 4, a.length)], [...a])
      assert.deepEqual([...lzwDecode(lzw.encode(b, 2), 2, b.length)], [...b])
    }
  })
})

describe('buildPalette and Mapper', () => {
  it('keeps the colours of a flat picture exactly', () => {
    const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 255, 0, 0, 1, 2, 3])
    const palette = buildPalette(rgb, 4, 256)
    assert.equal(palette.exact, true)
    assert.equal(palette.size, 3)
    const mapper = new Mapper(palette)
    assert.deepEqual([mapper.index(255, 0, 0), mapper.index(0, 255, 0), mapper.index(1, 2, 3)], [0, 1, 2])
  })

  it('cuts a picture with many colours down to the limit', () => {
    const next = random(9)
    const rgb = Uint8Array.from({ length: 3 * 5000 }, () => next(256))
    const palette = buildPalette(rgb, 5000, 100)
    assert.equal(palette.exact, false)
    assert.ok(palette.size <= 100 && palette.size > 50)
    const mapper = new Mapper(palette)
    for (let at = 0; at < 200; at++) {
      assert.ok(mapper.index(rgb[at * 3] as number, rgb[at * 3 + 1] as number, rgb[at * 3 + 2] as number) < palette.size)
    }
  })

  it('finds a close colour for a gradient', () => {
    const rgb = new Uint8Array(3 * 1024)
    for (let at = 0; at < 1024; at++) rgb.set([at >> 2, 255 - (at >> 2), (at * 7) & 255], at * 3)
    const palette = buildPalette(rgb, 1024, 64)
    const mapper = new Mapper(palette)
    let worst = 0
    for (let at = 0; at < 1024; at++) {
      const index = mapper.index(rgb[at * 3] as number, rgb[at * 3 + 1] as number, rgb[at * 3 + 2] as number)
      for (let channel = 0; channel < 3; channel++) {
        worst = Math.max(worst, Math.abs((rgb[at * 3 + channel] as number) - (palette.colors[index * 3 + channel] as number)))
      }
    }
    assert.ok(worst < 40, `worst error ${worst}`)
  })
})

describe('GifEncoder', () => {
  it('writes flat frames that read back exactly, with delays and the loop', () => {
    const colors: [number, number, number][] = [[200, 30, 30], [30, 160, 40], [40, 60, 200]]
    const frames = colors.map((color, at) => ({ rgba: solid(7, 5, color), delay: [5, 10, 250][at] as number }))
    const gif = decodeGif(encode(frames, { width: 7, height: 5 }))
    assert.equal(gif.width, 7)
    assert.equal(gif.height, 5)
    assert.equal(gif.loop, 0)
    assert.deepEqual(gif.frames.map((frame) => frame.delay), [5, 10, 250])
    gif.frames.forEach((frame, at) => assert.deepEqual([...frame.rgba], [...(frames[at] as { rgba: Uint8Array }).rgba]))
  })

  it('leaves the loop out when asked', () => {
    const gif = decodeGif(encode([{ rgba: solid(2, 2, [1, 2, 3]), delay: 4 }], { width: 2, height: 2, loop: null }))
    assert.equal(gif.loop, null)
  })

  it('stores only the rectangle that changed', () => {
    const base = solid(40, 30, [10, 20, 30])
    const moved = base.slice()
    for (let y = 10; y < 14; y++) for (let x = 20; x < 26; x++) moved.set([250, 250, 250, 255], (y * 40 + x) * 4)
    const gif = decodeGif(encode([{ rgba: base, delay: 3 }, { rgba: moved, delay: 3 }], { width: 40, height: 30 }))
    assert.equal(gif.frames.length, 2)
    const second = gif.frames[1]!
    assert.deepEqual([second.left, second.top, second.width, second.height], [20, 10, 6, 4])
    assert.deepEqual([...second.rgba], [...moved])
  })

  it('makes unchanged pixels inside the rectangle transparent', () => {
    const base = solid(20, 20, [10, 20, 30])
    const next = base.slice()
    next.set([200, 0, 0, 255], (2 * 20 + 2) * 4)
    next.set([0, 200, 0, 255], (15 * 20 + 15) * 4)
    const gif = decodeGif(encode([{ rgba: base, delay: 3 }, { rgba: next, delay: 3 }], { width: 20, height: 20 }))
    const second = gif.frames[1]!
    assert.deepEqual([second.left, second.top, second.width, second.height], [2, 2, 14, 14])
    assert.ok(second.transparent >= 0)
    assert.deepEqual([...second.rgba], [...next])
  })

  it('adds the delay of a repeated frame to the one before', () => {
    const a = solid(8, 8, [1, 1, 1])
    const b = solid(8, 8, [200, 200, 200])
    const gif = decodeGif(encode([{ rgba: a, delay: 4 }, { rgba: a.slice(), delay: 6 }, { rgba: b, delay: 5 }, { rgba: b.slice(), delay: 5 }], { width: 8, height: 8 }))
    assert.deepEqual(gif.frames.map((frame) => frame.delay), [10, 10])
  })

  it('ignores changes inside the tolerance', () => {
    const a = solid(8, 8, [100, 100, 100])
    const b = solid(8, 8, [104, 98, 100])
    const loose = decodeGif(encode([{ rgba: a, delay: 4 }, { rgba: b, delay: 4 }], { width: 8, height: 8, tolerance: 6 }))
    assert.equal(loose.frames.length, 1)
    assert.equal(loose.frames[0]!.delay, 8)
    const strict = decodeGif(encode([{ rgba: a, delay: 4 }, { rgba: b, delay: 4 }], { width: 8, height: 8, tolerance: 2 }))
    assert.equal(strict.frames.length, 2)
  })

  it('does not let slow drift pass for no change', () => {
    const frames = Array.from({ length: 6 }, (_, at) => ({ rgba: solid(4, 4, [100 + at * 4, 100, 100]), delay: 2 }))
    const gif = decodeGif(encode(frames, { width: 4, height: 4, tolerance: 6 }))
    const last = gif.frames[gif.frames.length - 1]!
    assert.ok(Math.abs((last.rgba[0] as number) - 120) <= 6)
  })

  it('reduces a picture with many colours to a palette of 256', () => {
    const next = random(3)
    const rgba = new Uint8Array(64 * 48 * 4)
    for (let at = 0; at < 64 * 48; at++) rgba.set([next(256), next(256), next(256), 255], at * 4)
    const gif = decodeGif(encode([{ rgba, delay: 5 }], { width: 64, height: 48 }))
    assert.equal(gif.frames[0]!.colors, 256)
    assert.equal(gif.frames[0]!.rgba.length, rgba.length)
  })

  it('keeps a smooth picture close to the original, better with dithering', () => {
    const w = 96
    const h = 64
    const rgba = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        rgba.set([(x * 255) / w, (y * 255) / h, ((x + y) * 255) / (w + h), 255], (y * w + x) * 4)
      }
    }
    const plain = decodeGif(encode([{ rgba, delay: 5 }], { width: w, height: h }))
    const dithered = decodeGif(encode([{ rgba, delay: 5 }], { width: w, height: h, dither: true }))
    assert.ok(psnr(rgba, plain.frames[0]!.rgba) > 30, `plain ${psnr(rgba, plain.frames[0]!.rgba)}`)
    assert.ok(psnr(rgba, dithered.frames[0]!.rgba) > 26, `dithered ${psnr(rgba, dithered.frames[0]!.rgba)}`)
  })

  it('handles a one pixel picture and odd sizes', () => {
    const one = decodeGif(encode([{ rgba: solid(1, 1, [9, 8, 7]), delay: 2 }], { width: 1, height: 1 }))
    assert.deepEqual([...one.frames[0]!.rgba], [9, 8, 7, 255])
    const odd = decodeGif(encode([{ rgba: solid(13, 7, [5, 5, 5]), delay: 2 }], { width: 13, height: 7 }))
    assert.equal(odd.frames[0]!.rgba.length, 13 * 7 * 4)
  })

  it('refuses an empty animation and frames after the end', () => {
    const encoder = new GifEncoder({ width: 2, height: 2, loop: 0, dither: false, tolerance: 0 }, () => {})
    assert.throws(() => encoder.finish())
    const other = new GifEncoder({ width: 2, height: 2, loop: 0, dither: false, tolerance: 0 }, () => {})
    other.addFrame(solid(2, 2, [1, 1, 1]), 1)
    other.finish()
    assert.throws(() => other.addFrame(solid(2, 2, [1, 1, 1]), 1))
  })
})
