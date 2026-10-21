// src/gif/quantize.ts

// Palettes of up to 256 colours for GIF frames, and the mapping of pixels onto
// them. Pixels travel as flat RGB bytes.

const BINS = 32768
const bin = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)

export interface Palette {
  // RGB bytes, three per colour.
  colors: Uint8Array
  size: number
  // True when every colour of the input is in the palette exactly.
  exact: boolean
}

interface Box {
  // Histogram bins in this box.
  bins: Int32Array
  population: number
}

// Median cut over a 15-bit histogram. A picture with no more colours than
// asked for keeps them exactly; flat graphics are common in GIFs.
export function buildPalette(rgb: Uint8Array, count: number, maxColors: number): Palette {
  const exact = new Map<number, number>()
  for (let at = 0; at < count; at++) {
    const key = ((rgb[at * 3] as number) << 16) | ((rgb[at * 3 + 1] as number) << 8) | (rgb[at * 3 + 2] as number)
    if (!exact.has(key)) {
      if (exact.size === maxColors) {
        exact.clear()
        break
      }
      exact.set(key, exact.size)
    }
  }
  if (exact.size > 0 || count === 0) {
    const colors = new Uint8Array(Math.max(exact.size, 1) * 3)
    for (const [key, index] of exact) {
      colors[index * 3] = key >> 16
      colors[index * 3 + 1] = (key >> 8) & 255
      colors[index * 3 + 2] = key & 255
    }
    return { colors, size: Math.max(exact.size, 1), exact: true }
  }

  const population = new Uint32Array(BINS)
  const sums = new Float64Array(BINS * 3)
  for (let at = 0; at < count; at++) {
    const r = rgb[at * 3] as number
    const g = rgb[at * 3 + 1] as number
    const b = rgb[at * 3 + 2] as number
    const index = bin(r, g, b)
    population[index] = (population[index] as number) + 1
    sums[index * 3] = (sums[index * 3] as number) + r
    sums[index * 3 + 1] = (sums[index * 3 + 1] as number) + g
    sums[index * 3 + 2] = (sums[index * 3 + 2] as number) + b
  }
  const present: number[] = []
  for (let index = 0; index < BINS; index++) if ((population[index] as number) > 0) present.push(index)

  const boxes: Box[] = [{ bins: Int32Array.from(present), population: count }]
  while (boxes.length < maxColors) {
    let pick = -1
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index] as Box
      if (box.bins.length > 1 && (pick < 0 || box.population > (boxes[pick] as Box).population)) pick = index
    }
    if (pick < 0) break
    const box = boxes[pick] as Box
    // The axis with the widest spread, green counting a little more.
    let loR = 31
    let hiR = 0
    let loG = 31
    let hiG = 0
    let loB = 31
    let hiB = 0
    for (const index of box.bins) {
      const r = index >> 10
      const g = (index >> 5) & 31
      const b = index & 31
      if (r < loR) loR = r
      if (r > hiR) hiR = r
      if (g < loG) loG = g
      if (g > hiG) hiG = g
      if (b < loB) loB = b
      if (b > hiB) hiB = b
    }
    const spreadR = hiR - loR
    const spreadG = (hiG - loG) * 1.2
    const spreadB = hiB - loB
    const axis = spreadG >= spreadR && spreadG >= spreadB ? 1 : spreadR >= spreadB ? 0 : 2
    const shift = axis === 0 ? 10 : axis === 1 ? 5 : 0
    const keys = new Float64Array(box.bins.length)
    for (let at = 0; at < keys.length; at++) {
      const index = box.bins[at] as number
      keys[at] = ((index >> shift) & 31) * BINS + index
    }
    keys.sort()
    const ordered = new Int32Array(keys.length)
    for (let at = 0; at < keys.length; at++) ordered[at] = (keys[at] as number) % BINS
    // Split where half of the pixels lie on each side.
    let seen = 0
    let cut = 1
    for (let at = 0; at < ordered.length - 1; at++) {
      seen += population[ordered[at] as number] as number
      cut = at + 1
      if (seen * 2 >= box.population) break
    }
    const left = ordered.subarray(0, cut)
    const right = ordered.subarray(cut)
    let leftPopulation = 0
    for (const index of left) leftPopulation += population[index] as number
    boxes[pick] = { bins: left, population: leftPopulation }
    boxes.push({ bins: right, population: box.population - leftPopulation })
  }

  const colors = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, at) => {
    let r = 0
    let g = 0
    let b = 0
    for (const index of box.bins) {
      r += sums[index * 3] as number
      g += sums[index * 3 + 1] as number
      b += sums[index * 3 + 2] as number
    }
    colors[at * 3] = Math.round(r / box.population)
    colors[at * 3 + 1] = Math.round(g / box.population)
    colors[at * 3 + 2] = Math.round(b / box.population)
  })
  return { colors, size: boxes.length, exact: false }
}

// Finds the nearest palette colour to RGB values, remembering the answer per
// 15-bit bin (or per exact colour for an exact palette).
export class Mapper {
  private readonly palette: Palette
  private readonly nearest = new Int16Array(BINS).fill(-1)
  private readonly exactIndex: Map<number, number> | null

  constructor(palette: Palette) {
    this.palette = palette
    if (palette.exact) {
      this.exactIndex = new Map()
      for (let at = 0; at < palette.size; at++) {
        const c = palette.colors
        this.exactIndex.set(((c[at * 3] as number) << 16) | ((c[at * 3 + 1] as number) << 8) | (c[at * 3 + 2] as number), at)
      }
    } else {
      this.exactIndex = null
    }
  }

  index(r: number, g: number, b: number): number {
    if (this.exactIndex) {
      const found = this.exactIndex.get((r << 16) | (g << 8) | b)
      if (found !== undefined) return found
    }
    const key = bin(r, g, b)
    const cached = this.nearest[key] as number
    if (cached >= 0) return cached
    const c = this.palette.colors
    let best = 0
    let bestDistance = Infinity
    for (let at = 0; at < this.palette.size; at++) {
      const dr = (c[at * 3] as number) - r
      const dg = (c[at * 3 + 1] as number) - g
      const db = (c[at * 3 + 2] as number) - b
      // Green is what the eye sees best.
      const distance = dr * dr * 2 + dg * dg * 4 + db * db * 3
      if (distance < bestDistance) {
        bestDistance = distance
        best = at
      }
    }
    this.nearest[key] = best
    return best
  }

  get colors(): Uint8Array {
    return this.palette.colors
  }
}
