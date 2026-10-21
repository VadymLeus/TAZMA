// src/gif/gifEncoder.ts
import { LzwEncoder } from './lzw.ts'
import { Mapper, buildPalette } from './quantize.ts'

export interface GifOptions {
  width: number
  height: number
  // Times the animation plays; 0 is for ever, null leaves the loop out (once).
  loop: number | null
  // Spread the colour error over neighbouring pixels.
  dither: boolean
  // A pixel whose colour moved by no more than this in every channel since it
  // was last written is left as it is; larger values give smaller files.
  tolerance: number
}

interface Held {
  left: number
  top: number
  width: number
  height: number
  palette: Uint8Array
  paletteBits: number
  // Index of the transparent colour, or -1.
  transparent: number
  data: Uint8Array
  minCodeSize: number
  delay: number
}

const u16 = (value: number) => [value & 255, (value >> 8) & 255]
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0))

// Writes an animated GIF. A frame goes in as RGBA; only the rectangle that
// changed since the previous frame is stored, with the unchanged pixels inside
// it transparent, and every frame gets a palette of its own. A frame that
// changes nothing just lengthens the previous one.
export class GifEncoder {
  private readonly options: GifOptions
  private readonly write: (chunk: Uint8Array) => void
  private readonly lzw = new LzwEncoder()
  // The colour each pixel had when it was last written.
  private readonly reference: Uint8Array
  private readonly mask: Uint8Array
  private held: Held | null = null
  private empty = true
  private finished = false

  constructor(options: GifOptions, write: (chunk: Uint8Array) => void) {
    this.options = options
    this.write = write
    this.reference = new Uint8Array(options.width * options.height * 3)
    this.mask = new Uint8Array(options.width * options.height)
  }

  private writeHeader() {
    const { width, height, loop } = this.options
    const bytes = [...ascii('GIF89a'), ...u16(width), ...u16(height), 0x70, 0, 0]
    if (loop !== null) bytes.push(0x21, 0xff, 0x0b, ...ascii('NETSCAPE2.0'), 3, 1, ...u16(loop), 0)
    this.write(Uint8Array.from(bytes))
  }

  private flush() {
    const frame = this.held
    if (!frame) return
    this.held = null
    const transparent = frame.transparent >= 0
    // Disposal 1: the next frame is drawn over this one.
    const head = Uint8Array.from([
      0x21, 0xf9, 4, (1 << 2) | (transparent ? 1 : 0), ...u16(frame.delay), transparent ? frame.transparent : 0, 0,
      0x2c, ...u16(frame.left), ...u16(frame.top), ...u16(frame.width), ...u16(frame.height), 0x80 | (frame.paletteBits - 1),
    ])
    const blocks = Math.ceil(frame.data.length / 255)
    const out = new Uint8Array(head.length + frame.palette.length + 1 + frame.data.length + blocks + 1)
    let pos = 0
    out.set(head, pos)
    pos += head.length
    out.set(frame.palette, pos)
    pos += frame.palette.length
    out[pos++] = frame.minCodeSize
    for (let at = 0; at < frame.data.length; at += 255) {
      const part = frame.data.subarray(at, Math.min(at + 255, frame.data.length))
      out[pos++] = part.length
      out.set(part, pos)
      pos += part.length
    }
    this.write(out)
  }

  // delay is in hundredths of a second.
  addFrame(rgba: Uint8Array | Uint8ClampedArray, delay: number): void {
    if (this.finished) throw new Error('GIF уже завершено.')
    const { width, height, tolerance } = this.options
    const { reference, mask } = this

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x
        const differs =
          this.empty ||
          Math.abs((rgba[at * 4] as number) - (reference[at * 3] as number)) > tolerance ||
          Math.abs((rgba[at * 4 + 1] as number) - (reference[at * 3 + 1] as number)) > tolerance ||
          Math.abs((rgba[at * 4 + 2] as number) - (reference[at * 3 + 2] as number)) > tolerance
        mask[at] = differs ? 1 : 0
        if (differs) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) {
      if (this.held) this.held.delay += delay
      return
    }
    if (this.empty) this.writeHeader()
    this.empty = false

    const boxWidth = maxX - minX + 1
    const boxHeight = maxY - minY + 1
    const colors = new Uint8Array(boxWidth * boxHeight * 3)
    let changed = 0
    for (let y = 0; y < boxHeight; y++) {
      for (let x = 0; x < boxWidth; x++) {
        const at = (minY + y) * width + (minX + x)
        if (!mask[at]) continue
        colors[changed * 3] = rgba[at * 4] as number
        colors[changed * 3 + 1] = rgba[at * 4 + 1] as number
        colors[changed * 3 + 2] = rgba[at * 4 + 2] as number
        changed++
      }
    }

    // One palette entry is kept for "unchanged" when the rectangle has holes.
    const holes = changed < boxWidth * boxHeight
    const palette = buildPalette(colors, changed, holes ? 255 : 256)
    const mapper = new Mapper(palette)
    const transparent = holes ? palette.size : -1
    const indices = new Uint8Array(boxWidth * boxHeight)
    if (this.options.dither && !palette.exact) {
      this.ditherInto(rgba, indices, mapper, transparent, minX, minY, boxWidth, boxHeight)
    } else {
      for (let y = 0; y < boxHeight; y++) {
        for (let x = 0; x < boxWidth; x++) {
          const at = (minY + y) * width + (minX + x)
          indices[y * boxWidth + x] = mask[at]
            ? mapper.index(rgba[at * 4] as number, rgba[at * 4 + 1] as number, rgba[at * 4 + 2] as number)
            : transparent
        }
      }
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const at = y * width + x
        if (!mask[at]) continue
        reference[at * 3] = rgba[at * 4] as number
        reference[at * 3 + 1] = rgba[at * 4 + 1] as number
        reference[at * 3 + 2] = rgba[at * 4 + 2] as number
      }
    }

    const tableSize = palette.size + (holes ? 1 : 0)
    let paletteBits = 1
    while (1 << paletteBits < tableSize) paletteBits++
    const table = new Uint8Array(3 << paletteBits)
    table.set(palette.colors.subarray(0, palette.size * 3))
    const minCodeSize = Math.max(2, paletteBits)

    this.flush()
    this.held = {
      left: minX,
      top: minY,
      width: boxWidth,
      height: boxHeight,
      palette: table,
      paletteBits,
      transparent,
      data: this.lzw.encode(indices, minCodeSize),
      minCodeSize,
      delay,
    }
  }

  // Floyd-Steinberg over the changed pixels of the rectangle; the error does
  // not flow into or out of pixels that stay as they were.
  private ditherInto(
    rgba: Uint8Array | Uint8ClampedArray,
    indices: Uint8Array,
    mapper: Mapper,
    transparent: number,
    left: number,
    top: number,
    boxWidth: number,
    boxHeight: number,
  ) {
    const { width } = this.options
    const colors = mapper.colors
    let current = new Float32Array((boxWidth + 2) * 3)
    let next = new Float32Array((boxWidth + 2) * 3)
    const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value)
    for (let y = 0; y < boxHeight; y++) {
      next.fill(0)
      for (let x = 0; x < boxWidth; x++) {
        const at = (top + y) * width + (left + x)
        if (!this.mask[at]) {
          indices[y * boxWidth + x] = transparent
          continue
        }
        const spread = (x + 1) * 3
        const r = clamp((rgba[at * 4] as number) + (current[spread] as number))
        const g = clamp((rgba[at * 4 + 1] as number) + (current[spread + 1] as number))
        const b = clamp((rgba[at * 4 + 2] as number) + (current[spread + 2] as number))
        const index = mapper.index(Math.round(r), Math.round(g), Math.round(b))
        indices[y * boxWidth + x] = index
        for (let channel = 0; channel < 3; channel++) {
          const value = channel === 0 ? r : channel === 1 ? g : b
          const error = value - (colors[index * 3 + channel] as number)
          current[spread + 3 + channel] = (current[spread + 3 + channel] as number) + (error * 7) / 16
          next[spread - 3 + channel] = (next[spread - 3 + channel] as number) + (error * 3) / 16
          next[spread + channel] = (next[spread + channel] as number) + (error * 5) / 16
          next[spread + 3 + channel] = (next[spread + 3 + channel] as number) + error / 16
        }
      }
      const swap = current
      current = next
      next = swap
    }
  }

  finish(): void {
    if (this.finished) return
    this.finished = true
    if (this.empty) throw new Error('У GIF немає кадрів.')
    this.flush()
    this.write(Uint8Array.of(0x3b))
  }
}
