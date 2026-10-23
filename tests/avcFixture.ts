// tests/avcFixture.ts

// An avcC record holding the given parameter set units.
export function avcC(sps: number[][], pps: number[][], lengthSize = 4): Uint8Array {
  const bytes = [1, 0x64, 0, 0x1f, 0xfc | (lengthSize - 1), 0xe0 | sps.length]
  for (const unit of sps) bytes.push(unit.length >> 8, unit.length & 0xff, ...unit)
  bytes.push(pps.length)
  for (const unit of pps) bytes.push(unit.length >> 8, unit.length & 0xff, ...unit)
  return Uint8Array.from(bytes)
}

// A packet of length-prefixed NAL units.
export function packetOf(units: number[][], lengthSize = 4): Uint8Array {
  const bytes: number[] = []
  for (const unit of units) {
    for (let index = lengthSize - 1; index >= 0; index--) bytes.push((unit.length >> (8 * index)) & 0xff)
    bytes.push(...unit)
  }
  return Uint8Array.from(bytes)
}
