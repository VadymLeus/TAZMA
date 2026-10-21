// src/resume/crc32.ts
const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

// CRC-32 (the one in zip and PNG). Pass the result of an earlier call as
// `previous` to go on over the next block of the same data.
export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0
  for (let i = 0; i < data.length; i++) c = (TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8)
  return ~c >>> 0
}
