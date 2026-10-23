// src/gif/lzw.ts

const MAX_CODES = 4096
const KEY_SIZE = MAX_CODES * 256

// LZW as GIF uses it: codes of growing width, a clear code when the table is
// full. The dictionary is a direct table over (prefix code, next byte); a stamp
// per slot tells whether it belongs to the table in use, so starting a new
// table costs nothing. One encoder serves many frames.
export class LzwEncoder {
  private readonly codes = new Uint16Array(KEY_SIZE)
  private readonly stamps = new Uint32Array(KEY_SIZE)
  private stamp = 0
  private out = new Uint8Array(4096)
  private size = 0
  private bits = 0
  private held = 0

  private put(code: number, width: number) {
    this.held |= code << this.bits
    this.bits += width
    while (this.bits >= 8) {
      if (this.size === this.out.length) {
        const next = new Uint8Array(this.out.length * 2)
        next.set(this.out)
        this.out = next
      }
      this.out[this.size++] = this.held & 0xff
      this.held >>>= 8
      this.bits -= 8
    }
  }

  // minCodeSize is the bit depth of the indices, at least 2.
  encode(indices: Uint8Array, minCodeSize: number): Uint8Array {
    this.size = 0
    this.bits = 0
    this.held = 0
    const clear = 1 << minCodeSize
    const end = clear + 1
    let next = end + 1
    let width = minCodeSize + 1
    this.stamp++
    this.put(clear, width)
    if (indices.length === 0) {
      this.put(end, width)
      return this.finish()
    }

    let prefix = indices[0] as number
    for (let at = 1; at < indices.length; at++) {
      const byte = indices[at] as number
      const key = (prefix << 8) | byte
      if (this.stamps[key] === this.stamp) {
        prefix = this.codes[key] as number
        continue
      }
      this.put(prefix, width)
      if (next < MAX_CODES) {
        this.stamps[key] = this.stamp
        this.codes[key] = next
        // The width grows once a code needs another bit.
        if (next === 1 << width) width++
        next++
      } else {
        this.put(clear, width)
        this.stamp++
        next = end + 1
        width = minCodeSize + 1
      }
      prefix = byte
    }
    this.put(prefix, width)
    // The decoder adds an entry after this code too, which can widen its codes.
    if (next < MAX_CODES && next === 1 << width) width++
    this.put(end, width)
    return this.finish()
  }

  private finish(): Uint8Array {
    if (this.bits > 0) this.put(0, 8 - this.bits)
    return this.out.slice(0, this.size)
  }
}
