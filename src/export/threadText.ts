// src/export/threadText.ts
import type { UiStats } from '../diagnostics/responsiveness.ts'

// Where the export ran and how the page fared, as label and value rows for the
// result. Empty when the export did not say.
export function threadRows(
  thread: 'worker' | 'main' | undefined,
  ui: UiStats | null | undefined,
  heapHidden = false,
): [string, string][] {
  if (!thread) return []
  const rows: [string, string][] = [
    ['Потік', thread === 'worker' ? 'Окремий потік (Web Worker)' : 'Основний потік сторінки'],
  ]
  if (ui) {
    const parts: string[] = []
    if (ui.maxGapMs !== null) parts.push(`найдовша затримка відповіді ${ui.maxGapMs} мс`)
    parts.push(
      ui.longTasks === 0
        ? 'довгих пауз немає'
        : `довгих пауз: ${ui.longTasks}, найдовша ${ui.longestMs} мс, разом ${ui.totalMs} мс`,
    )
    rows.push(['Інтерфейс', parts.join('; ')])
  }
  if (heapHidden) rows.push(['Купа JavaScript', 'у фоновому потоці браузер її не показує'])
  return rows
}
