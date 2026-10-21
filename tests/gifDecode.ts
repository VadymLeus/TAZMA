// tests/gifDecode.ts

// A small GIF reader for the tests, written apart from the encoder.

export function lzwDecode(data: Uint8Array, minCodeSize: number, pixels: number): Uint8Array {
  const clear = 1 << minCodeSize
  const end = clear + 1
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const out = new Uint8Array(pixels)
  let size = 0
  let width = minCodeSize + 1
  let next = end + 1
  let previous = -1
  let bits = 0
  let held = 0
  let at = 0
  const stack = new Uint8Array(4097)

  const expand = (code: number): number => {
    let top = 0
    let current = code
    while (current >= clear + 2) {
      stack[top++] = suffix[current] as number
      current = prefix[current] as number
    }
    stack[top++] = current
    for (let index = top - 1; index >= 0; index--) {
      if (size < pixels) out[size++] = stack[index] as number
    }
    return current
  }

  for (;;) {
    while (bits < width) {
      if (at >= data.length) return out.subarray(0, size)
      held |= (data[at++] as number) << bits
      bits += 8
    }
    const code = held & ((1 << width) - 1)
    held >>>= width
    bits -= width
    if (code === clear) {
      width = minCodeSize + 1
      next = end + 1
      previous = -1
      continue
    }
    if (code === end) break
    if (previous < 0) {
      expand(code)
      previous = code
      continue
    }
    let first: number
    if (code < next) {
      first = expand(code)
    } else {
      // The code being defined right now: previous plus its own first byte.
      const lead = expandFirst(previous)
      first = lead
      expand(previous)
      if (size < pixels) out[size++] = lead
    }
    if (next < 4096) {
      prefix[next] = previous
      suffix[next] = first
      next++
      if (next === 1 << width && width < 12) width++
    }
    previous = code
  }
  return out.subarray(0, size)

  function expandFirst(code: number): number {
    let current = code
    while (current >= clear + 2) current = prefix[current] as number
    return current
  }
}

export interface DecodedFrame {
  // The whole canvas after this frame, RGBA.
  rgba: Uint8Array
  delay: number
  left: number
  top: number
  width: number
  height: number
  transparent: number
  disposal: number
  colors: number
}

export interface DecodedGif {
  width: number
  height: number
  loop: number | null
  frames: DecodedFrame[]
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const text = String.fromCharCode(...bytes.subarray(0, 6))
  if (text !== 'GIF89a') throw new Error(`bad signature ${text}`)
  const u16 = (at: number) => (bytes[at] as number) | ((bytes[at + 1] as number) << 8)
  const width = u16(6)
  const height = u16(8)
  const flags = bytes[10] as number
  let at = 13
  let globalTable: Uint8Array | null = null
  if (flags & 0x80) {
    const length = 3 << ((flags & 7) + 1)
    globalTable = bytes.subarray(at, at + length)
    at += length
  }
  let loop: number | null = null
  let control = { delay: 0, transparent: -1, disposal: 0 }
  const canvas = new Uint8Array(width * height * 4)
  const frames: DecodedFrame[] = []

  for (;;) {
    const marker = bytes[at++] as number
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = bytes[at++] as number
      if (label === 0xf9) {
        const packed = bytes[at + 1] as number
        control = {
          delay: u16(at + 2),
          transparent: packed & 1 ? (bytes[at + 4] as number) : -1,
          disposal: (packed >> 2) & 7,
        }
      }
      if (label === 0xff) {
        const name = String.fromCharCode(...bytes.subarray(at + 1, at + 12))
        if (name === 'NETSCAPE2.0') loop = u16(at + 14)
      }
      // Skip the sub-blocks.
      let size = bytes[at++] as number
      while (size !== 0) {
        at += size
        size = bytes[at++] as number
      }
      continue
    }
    if (marker !== 0x2c) throw new Error(`unexpected byte ${marker} at ${at - 1}`)
    const left = u16(at)
    const top = u16(at + 2)
    const w = u16(at + 4)
    const h = u16(at + 6)
    const local = bytes[at + 8] as number
    at += 9
    let table = globalTable
    let colors = table ? table.length / 3 : 0
    if (local & 0x80) {
      const length = 3 << ((local & 7) + 1)
      table = bytes.subarray(at, at + length)
      colors = length / 3
      at += length
    }
    if (!table) throw new Error('no colour table')
    const minCodeSize = bytes[at++] as number
    const parts: number[] = []
    let size = bytes[at++] as number
    while (size !== 0) {
      for (let index = 0; index < size; index++) parts.push(bytes[at + index] as number)
      at += size
      size = bytes[at++] as number
    }
    const indices = lzwDecode(Uint8Array.from(parts), minCodeSize, w * h)
    if (indices.length !== w * h) throw new Error(`short image: ${indices.length} of ${w * h}`)
    const before = canvas.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const index = indices[y * w + x] as number
        if (index === control.transparent) continue
        const target = ((top + y) * width + (left + x)) * 4
        canvas[target] = table[index * 3] as number
        canvas[target + 1] = table[index * 3 + 1] as number
        canvas[target + 2] = table[index * 3 + 2] as number
        canvas[target + 3] = 255
      }
    }
    frames.push({ rgba: canvas.slice(), delay: control.delay, left, top, width: w, height: h, transparent: control.transparent, disposal: control.disposal, colors })
    if (control.disposal === 2) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) canvas.fill(0, ((top + y) * width + (left + x)) * 4, ((top + y) * width + (left + x)) * 4 + 4)
      }
    } else if (control.disposal === 3) {
      canvas.set(before)
    }
    control = { delay: 0, transparent: -1, disposal: 0 }
  }
  return { width, height, loop, frames }
}
