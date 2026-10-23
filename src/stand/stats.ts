// src/stand/stats.ts

export interface Summary {
  n: number
  min: number
  max: number
  mean: number
  median: number
  q1: number
  q3: number
  // Sample standard deviation; 0 for a single value.
  sd: number
}

// The p-th quantile (0 to 1) of an ascending list, by linear interpolation
// between the closest values.
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

// What a series of readings comes to. Values that are not finite numbers are
// left out; null when nothing is left.
export function summarize(values: number[]): Summary | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return null
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n
  const variance = n > 1 ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    sd: Math.sqrt(variance),
  }
}

// The interquartile range as a share of the median: how much the runs differ.
export function spread(summary: Summary): number | null {
  return summary.median !== 0 ? (summary.q3 - summary.q1) / Math.abs(summary.median) : null
}
