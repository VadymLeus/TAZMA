// src/export/flowText.ts
import { framesText } from '../media/format.ts'
import type { FlowReport } from '../pipeline/flowControl.ts'
import { attemptLabel } from './attempts.ts'
import type { ExportAttempt, FailedAttempt } from './attempts.ts'

const decimal = (value: number, digits: number) =>
  parseFloat(value.toFixed(digits)).toString().replace('.', ',')

// What the frame limit was and how it worked, as label and value rows for the
// result. Empty when the export ran without a limit of its own.
export function flowRows(
  report: FlowReport | null | undefined,
  fallback?: { failed: FailedAttempt[]; used: ExportAttempt } | null,
): [string, string][] {
  if (fallback) {
    return [
      [
        'Конвеєр',
        `Не вдалося: ${fallback.failed.map((item) => `«${attemptLabel(item.attempt)}»`).join(', ')}. Експорт зроблено так: «${attemptLabel(fallback.used)}»`,
      ],
      ...fallback.failed.map((item): [string, string] => [`Помилка (${attemptLabel(item.attempt)})`, item.error]),
    ]
  }
  if (!report) return []
  const rows: [string, string][] = []
  if (report.mode === 'fixed') {
    rows.push(['Конвеєр', `Вручну: N = ${report.limit}`])
  } else {
    const parts = [`за пам’яттю ${report.byMemory}`]
    if (report.byThroughput !== null) parts.push(`за швидкістю ${report.byThroughput}`)
    rows.push(['Конвеєр', `Авто: N = ${report.limit} (${parts.join(', ')})`])
    if (report.rate !== null && report.latencyMs !== null) {
      rows.push([
        'Виміряно',
        `λ ≈ ${Math.round(report.rate)} кадр/с, W₀ ≈ ${decimal(report.latencyMs, report.latencyMs < 10 ? 1 : 0)} мс, запас δ = ${Math.round(report.margin * 100)} %`,
      ])
    } else {
      rows.push(['Виміряно', 'експорт був надто коротким для виміру'])
    }
  }
  if (report.tried > 0) {
    const rates = report.trials.map((item) => `N = ${item.limit}: ${Math.round(item.rate)}`).join('; ')
    const result = report.kept > 0 ? `знайдено N = ${report.climbedTo}` : 'вищий N швидкості не додав'
    rows.push(['Підбір N', `${result}. Кадр/с при різних N: ${rates}`])
  }
  const extra: string[] = [`пік ${framesText(report.peak)}`]
  if (report.borrowed > 0) extra.push(`позичено кредитів: ${report.borrowed}`)
  if (report.released) extra.push('ліміт знято: конвеєр затримував кадри')
  rows.push(['У конвеєрі', extra.join(', ')])
  return rows
}
