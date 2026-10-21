// src/diagnostics/chartMath.ts

const NICE_STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10]

// The next "round" number at or above a value: 1, 1.5, 2, 3, 4, 5, 6, 8 or 10
// times a power of ten.
export function niceCeil(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1
  const base = 10 ** Math.floor(Math.log10(value))
  const part = value / base
  const nice = NICE_STEPS.find((step) => part <= step) ?? 10
  return nice * base
}

// Tick values from zero to max. Counts stay whole numbers.
export function tickValues(max: number, whole: boolean): number[] {
  const middle = max / 2
  if (whole && !Number.isInteger(middle)) return [0, max]
  return [0, middle, max]
}

// Seconds as a short axis label: 0,4 с, 45 с, 2 хв, 1 год 5 хв.
export function formatAxisSeconds(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1).replace('.', ',')} с`
  const whole = Math.round(seconds)
  if (whole < 90) return `${whole} с`
  const minutes = Math.round(whole / 60)
  if (minutes < 90) return `${minutes} хв`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} год` : `${hours} год ${rest} хв`
}

// Labels for the ticks of one axis in a single unit, so they read as a
// scale: 0,0 с · 2,2 с · 4,4 с, or 0 с · 22 с · 43 с, or 0 хв · 15 хв · 30 хв.
export function formatAxisTicks(values: number[]): string[] {
  const max = values.reduce((highest, value) => Math.max(highest, value), 0)
  if (max < 10) return values.map((value) => `${value.toFixed(1).replace('.', ',')} с`)
  if (max < 90) return values.map((value) => `${Math.round(value)} с`)
  if (max < 5400) return values.map((value) => `${Math.round(value / 60)} хв`)
  return values.map((value) => `${parseFloat((value / 3600).toFixed(1)).toString().replace('.', ',')} год`)
}

// Index of the point whose x is nearest to a position, for a hover readout.
export function nearestIndex(xs: number[], position: number): number {
  let best = 0
  let distance = Infinity
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs((xs[i] as number) - position)
    if (d < distance) {
      distance = d
      best = i
    }
  }
  return best
}
