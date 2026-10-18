// src/project/effects.ts
import type { Effect, EffectKind } from './types.ts'

export const EFFECTS: { kind: EffectKind; label: string }[] = [
  { kind: 'grayscale', label: 'Чорно-білий' },
]

export function clampAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.min(Math.max(amount, 0), 1)
}

// An effect with zero strength changes nothing, so it never forces a re-encode.
export function isActive(effect: Effect | undefined): effect is Effect {
  return effect !== undefined && effect.amount > 0
}

// One filter string drives the preview (CSS) and the export (canvas filter).
export function effectFilter(effect: Effect | undefined): string {
  if (!isActive(effect)) return 'none'
  const amount = Math.round(clampAmount(effect.amount) * 1000) / 1000
  switch (effect.kind) {
    case 'grayscale':
      return `grayscale(${amount})`
  }
}
