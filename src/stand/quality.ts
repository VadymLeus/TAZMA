// src/stand/quality.ts

// PSNR of identical pictures is infinite; it is shown as this many decibels.
export const PSNR_CAP = 100

const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2

function sameSize(a: ArrayLike<number>, b: ArrayLike<number>): void {
  if (a.length !== b.length || a.length === 0) throw new RangeError('Картинки мають бути однакового розміру.')
}

// The brightness of every pixel of an RGBA picture (BT.601 weights).
export function lumaOf(rgba: ArrayLike<number>): Uint8Array {
  if (rgba.length % 4 !== 0) throw new RangeError('Кількість байтів RGBA має ділитися на 4.')
  const luma = new Uint8Array(rgba.length / 4)
  for (let i = 0, j = 0; i < luma.length; i++, j += 4) {
    luma[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2] + 128) >> 8
  }
  return luma
}

// Peak signal-to-noise ratio of two brightness planes, in decibels.
export function psnr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  sameSize(a, b)
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  const mse = sum / a.length
  return mse === 0 ? PSNR_CAP : Math.min(PSNR_CAP, 10 * Math.log10((255 * 255) / mse))
}

// Structural similarity of two brightness planes: the mean over windows of 8
// by 8 pixels taken every 4 pixels; a picture smaller than a window is one
// window.
export function ssim(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number): number {
  sameSize(a, b)
  if (width * height !== a.length) throw new RangeError('Розмір не збігається з кількістю пікселів.')
  const window = Math.min(8, width, height)
  const stride = Math.max(1, Math.min(4, window))
  const count = window * window
  let total = 0
  let windows = 0
  for (let y = 0; y + window <= height; y += stride) {
    for (let x = 0; x + window <= width; x += stride) {
      let sumA = 0
      let sumB = 0
      let sumAA = 0
      let sumBB = 0
      let sumAB = 0
      for (let j = 0; j < window; j++) {
        const row = (y + j) * width + x
        for (let i = 0; i < window; i++) {
          const p = a[row + i]
          const q = b[row + i]
          sumA += p
          sumB += q
          sumAA += p * p
          sumBB += q * q
          sumAB += p * q
        }
      }
      const meanA = sumA / count
      const meanB = sumB / count
      const varA = sumAA / count - meanA * meanA
      const varB = sumBB / count - meanB * meanB
      const cov = sumAB / count - meanA * meanB
      total += ((2 * meanA * meanB + C1) * (2 * cov + C2)) / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2))
      windows++
    }
  }
  return windows === 0 ? 1 : total / windows
}

export interface FrameQuality {
  psnr: number
  ssim: number
}

// Compares two RGBA pictures of the same size by their brightness.
export function compareFrames(reference: ArrayLike<number>, output: ArrayLike<number>, width: number, height: number): FrameQuality {
  const a = lumaOf(reference)
  const b = lumaOf(output)
  return { psnr: psnr(a, b), ssim: ssim(a, b, width, height) }
}

export interface QualityReport {
  frames: number
  // Frames that came out as they are in the reference.
  identical: number
  // Mean PSNR over the frames that differ; null when none does.
  psnrMean: number | null
  psnrMin: number
  ssimMean: number
  ssimMin: number
}

// The figures of a set of frames compared one by one.
export function summarizeQuality(list: FrameQuality[]): QualityReport | null {
  if (list.length === 0) return null
  const differing = list.filter((item) => item.psnr < PSNR_CAP)
  return {
    frames: list.length,
    identical: list.length - differing.length,
    psnrMean: differing.length > 0 ? differing.reduce((sum, item) => sum + item.psnr, 0) / differing.length : null,
    psnrMin: Math.min(...list.map((item) => item.psnr)),
    ssimMean: list.reduce((sum, item) => sum + item.ssim, 0) / list.length,
    ssimMin: Math.min(...list.map((item) => item.ssim)),
  }
}

// Times to compare at: `count` places spread over the timeline, each at the
// middle of a frame of the given rate.
export function sampleTimes(duration: number, count: number, frameRate: number): number[] {
  if (!(duration > 0) || count < 1 || !(frameRate > 0)) return []
  const frames = Math.max(1, Math.floor(duration * frameRate))
  const step = frames / count
  const picked = new Set<number>()
  for (let i = 0; i < count; i++) picked.add(Math.min(frames - 1, Math.floor((i + 0.5) * step)))
  return [...picked].map((frame) => (frame + 0.5) / frameRate)
}
