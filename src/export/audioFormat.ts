// src/export/audioFormat.ts

const MINUS_3_DB = Math.SQRT1_2

// Mixes any channel layout down (or up) to stereo. 5.1 uses the usual
// centre and surround weights; other layouts average their left and right halves.
export function remixToStereo(planes: Float32Array[]): [Float32Array, Float32Array] {
  const frames = planes[0]?.length ?? 0
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const count = planes.length

  if (count === 1) {
    left.set(planes[0])
    right.set(planes[0])
  } else if (count === 2) {
    left.set(planes[0])
    right.set(planes[1])
  } else if (count === 6) {
    const [fl, fr, c, , sl, sr] = planes
    for (let i = 0; i < frames; i++) {
      left[i] = (fl[i] + MINUS_3_DB * c[i] + MINUS_3_DB * sl[i]) / 2.414
      right[i] = (fr[i] + MINUS_3_DB * c[i] + MINUS_3_DB * sr[i]) / 2.414
    }
  } else if (count > 2) {
    for (let ch = 0; ch < count; ch++) {
      const target = ch % 2 === 0 ? left : right
      for (let i = 0; i < frames; i++) target[i] += planes[ch][i]
    }
    const scale = 1 / Math.ceil(count / 2)
    for (let i = 0; i < frames; i++) {
      left[i] *= scale
      right[i] *= scale
    }
  }
  return [left, right]
}

// Linear interpolation is enough for a rare 44.1 kHz source in a 48 kHz file.
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const output = new Float32Array(length)
  const step = fromRate / toRate
  const last = input.length - 1
  for (let i = 0; i < length; i++) {
    const position = i * step
    const index = Math.min(Math.floor(position), last)
    const next = Math.min(index + 1, last)
    const fraction = position - index
    output[i] = input[index] * (1 - fraction) + input[next] * fraction
  }
  return output
}
