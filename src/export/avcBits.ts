// src/export/avcBits.ts

// Bit-level reading and writing of H.264 syntax elements.

// Removes emulation prevention bytes (00 00 03 -> 00 00).
export function unescape(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  let size = 0
  let zeros = 0
  for (let index = 0; index < data.length; index++) {
    const byte = data[index] as number
    if (zeros >= 2 && byte === 3) {
      zeros = 0
      continue
    }
    out[size++] = byte
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return out.subarray(0, size)
}

// Inserts emulation prevention bytes where a unit would hold 00 00 0x (x <= 3).
export function escape(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + (data.length >> 1) + 8)
  let size = 0
  let zeros = 0
  for (let index = 0; index < data.length; index++) {
    const byte = data[index] as number
    if (zeros >= 2 && byte <= 3) {
      out[size++] = 3
      zeros = 0
    }
    out[size++] = byte
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return out.slice(0, size)
}

export class BitReader {
  pos = 0
  private readonly data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  get length(): number {
    return this.data.length * 8
  }

  bit(): number {
    if (this.pos >= this.length) throw new RangeError('Кінець даних.')
    const value = ((this.data[this.pos >> 3] ?? 0) >> (7 - (this.pos & 7))) & 1
    this.pos++
    return value
  }

  bits(count: number): number {
    let value = 0
    for (let index = 0; index < count; index++) value = value * 2 + this.bit()
    return value
  }

  ue(): number {
    let zeros = 0
    while (this.bit() === 0) {
      zeros++
      if (zeros > 32) throw new RangeError('Некоректний код.')
    }
    return 2 ** zeros - 1 + this.bits(zeros)
  }

  se(): number {
    const value = this.ue()
    if (value === 0) return 0
    return value % 2 === 1 ? (value + 1) / 2 : -(value / 2)
  }
}

export class BitWriter {
  private bytes = new Uint8Array(256)
  pos = 0

  private ensure(bits: number) {
    const need = (this.pos + bits + 7) >> 3
    if (need <= this.bytes.length) return
    const next = new Uint8Array(Math.max(need, this.bytes.length * 2))
    next.set(this.bytes)
    this.bytes = next
  }

  bit(value: number) {
    this.ensure(1)
    if (value) this.bytes[this.pos >> 3] = (this.bytes[this.pos >> 3] ?? 0) | (0x80 >> (this.pos & 7))
    this.pos++
  }

  // The low count bits of value, most significant first.
  bits(value: number, count: number) {
    this.ensure(count)
    let remaining = count
    while (remaining > 0) {
      const free = 8 - (this.pos & 7)
      const take = Math.min(free, remaining)
      const chunk = Math.floor(value / 2 ** (remaining - take)) % 2 ** take
      const at = this.pos >> 3
      this.bytes[at] = (this.bytes[at] ?? 0) | (chunk << (free - take))
      this.pos += take
      remaining -= take
    }
  }

  ue(value: number) {
    const code = value + 1
    const length = Math.floor(Math.log2(code))
    this.bits(0, length)
    this.bits(code, length + 1)
  }

  // Copies the bits [from, to) of a byte array.
  copy(source: Uint8Array, from: number, to: number) {
    let at = from
    // Up to a byte boundary of the source.
    while (at < to && (at & 7) !== 0) {
      const take = Math.min(8 - (at & 7), to - at)
      this.bits(((source[at >> 3] ?? 0) >> (8 - (at & 7) - take)) & ((1 << take) - 1), take)
      at += take
    }
    // Whole bytes, shifted to where the writer stands.
    const whole = (to - at) >> 3
    if (whole > 0) {
      this.ensure(whole * 8)
      const first = at >> 3
      const start = this.pos >> 3
      const shift = this.pos & 7
      if (shift === 0) {
        this.bytes.set(source.subarray(first, first + whole), start)
      } else {
        for (let index = 0; index < whole; index++) {
          const byte = source[first + index] as number
          this.bytes[start + index] = (this.bytes[start + index] as number) | (byte >> shift)
          this.bytes[start + index + 1] = (byte << (8 - shift)) & 0xff
        }
      }
      this.pos += whole * 8
      at += whole * 8
    }
    // The tail.
    while (at < to) {
      const take = to - at
      this.bits(((source[at >> 3] ?? 0) >> (8 - (at & 7) - take)) & ((1 << take) - 1), take)
      at += take
    }
  }

  alignWith(bit: number) {
    while (this.pos & 7) this.bit(bit)
  }

  append(bytes: Uint8Array) {
    if (this.pos & 7) throw new Error('Дані не вирівняно.')
    this.ensure(bytes.length * 8)
    this.bytes.set(bytes, this.pos >> 3)
    this.pos += bytes.length * 8
  }

  result(): Uint8Array {
    return this.bytes.slice(0, (this.pos + 7) >> 3)
  }
}

// Position of the stop bit that ends a unit's payload.
export function stopBit(rbsp: Uint8Array): number {
  let index = rbsp.length - 1
  while (index >= 0 && rbsp[index] === 0) index--
  if (index < 0) throw new RangeError('Немає завершального біта.')
  const byte = rbsp[index] ?? 0
  let shift = 0
  while (((byte >> shift) & 1) === 0) shift++
  return index * 8 + (7 - shift)
}
