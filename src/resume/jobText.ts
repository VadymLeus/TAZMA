// src/resume/jobText.ts
import { partsWord } from '../export/journalText.ts'
import { formatBytes, formatSpan } from '../media/format.ts'
import type { JobSummary } from './jobs.ts'

// How much of the timeline the journal covers, in whole percent.
export function coveredPercent(job: JobSummary): number {
  if (!(job.total > 0)) return 0
  return Math.min(100, Math.max(0, Math.round((job.covered / job.total) * 100)))
}

// What the journal holds, in a line.
export function progressLine(job: JobSummary): string {
  return `Готово ${formatSpan(job.covered)} з ${formatSpan(job.total)} (${coveredPercent(job)} %) · ${job.segments} ${partsWord(job.segments)} · ${formatBytes(job.bytes)}`
}

// What is left to do, in a line.
export function remainderLine(job: JobSummary): string {
  const sound = job.audio === 'done' ? 'Звук закодовано.' : job.audio === 'pending' ? 'Звук ще не закодовано.' : 'Звуку немає.'
  const rest = job.complete ? 'Усе відео в журналі, лишилось зібрати файл.' : 'Решту відео буде закодовано.'
  return `${sound} ${rest}`
}
