// src/export/attempts.ts
import type { FlowChoice } from './types.ts'

// One way of running an export: with which frame limit, and whether the
// browser is asked to decode in software.
export interface ExportAttempt {
  flow: FlowChoice
  software: boolean
}

export interface FailedAttempt {
  attempt: ExportAttempt
  error: string
}

// What an export falls back to when the decoder fails: first without the
// frame limit, then without hardware decoding as well.
export function planAttempts(flow: FlowChoice): ExportAttempt[] {
  const first: ExportAttempt = { flow, software: false }
  const library: ExportAttempt = { flow: 'library', software: false }
  const software: ExportAttempt = { flow: 'library', software: true }
  return flow === 'library' ? [first, software] : [first, library, software]
}

const FLOW_NAMES: Record<FlowChoice, string> = {
  auto: 'Авто',
  fixed: 'Вручну',
  library: 'Бібліотека',
}

export function attemptLabel(attempt: ExportAttempt): string {
  const name = FLOW_NAMES[attempt.flow]
  return attempt.software ? `${name}, програмне декодування` : name
}
