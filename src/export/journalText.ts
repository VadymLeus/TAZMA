// src/export/journalText.ts
import { formatBytes } from '../media/format.ts'
import { recommendationOf } from '../resume/recommend.ts'
import type { Suggestion } from '../resume/recommend.ts'
import type { JournalReport } from './types.ts'

const decimal = (value: number, digits: number) =>
  parseFloat(value.toFixed(digits)).toString().replace('.', ',')

// "частина", "частини" or "частин" for a count: 1 частина, 3 частини, 5 частин.
export function partsWord(count: number): string {
  const n = Math.abs(Math.round(count))
  const rest = n % 100
  const last = n % 10
  if (rest >= 11 && rest <= 14) return 'частин'
  if (last === 1) return 'частина'
  if (last >= 2 && last <= 4) return 'частини'
  return 'частин'
}

const seconds = (ms: number) => `${decimal(ms / 1000, ms < 10000 ? 1 : 0)} с`

// The part length the formula would give from what this export measured, next
// to the one it used. Nothing when no part was closed or no video was made.
function intervalRow(report: JournalReport, duration: number): [string, string] | null {
  const found = recommendationOf(report, duration)
  if (!found) return null
  const { plan, cost, mtbfMinutes, usedWaste } = found
  const percent = (value: number) => `${decimal(value * 100, 1)} %`
  const limit = plan.clamped ? ' (межа допустимого)' : ''
  return [
    'Довжина частини',
    `за формулою τ = √(2·t_c·M) при t_c = ${Math.round(cost * 1000)} мс і M = ${decimal(mtbfMinutes, 1)} хв вийшло б ${plan.segment} с${limit} із втратами ≈ ${percent(plan.waste)}; тут було ${decimal(report.segmentSeconds, 1)} с із втратами ≈ ${percent(usedWaste)}`,
  ]
}

// What the formula says of the length of a part, and what it was worked out
// from: shown in the export dialog while the person chooses.
export function suggestionText(found: Suggestion): string {
  const { plan, cost, speed } = found
  const basis = found.measured
    ? `t_c = ${Math.round(cost * 1000)} мс і швидкість ×${decimal(speed, 1)} виміряно в цьому браузері`
    : `t_c = ${Math.round(cost * 1000)} мс і швидкість ×${decimal(speed, 1)} — типові значення, поки в цьому браузері не було експорту з журналом`
  const limit = plan.clamped ? ' (межа допустимого)' : ''
  return `За формулою τ = √(2·t_c·M): ${basis}. Виходить ${decimal(plan.work, 1)} с роботи, тобто ${plan.segment} с таймлайну${limit}; очікувані втрати ≈ ${decimal(plan.waste * 100, 1)} %.`
}

// What the journal did, as label and value rows for the result. Empty when the
// export did not go through a journal. With the duration of the timeline the
// rows also say which part length the formula would have chosen.
export function journalRows(
  report: JournalReport | null | undefined,
  duration?: number,
): [string, string][] {
  if (!report) return []
  const rows: [string, string][] = [
    [
      'Журнал',
      `${report.segments} ${partsWord(report.segments)} по ${decimal(report.segmentSeconds, 1)} с, ${formatBytes(report.journalBytes)} у сховищі браузера`,
    ],
  ]
  if (report.resumedFrom > 0) {
    rows.push(['Відновлення', `експорт продовжено з ${decimal(report.resumedFrom, 1)} с таймлайну`])
  }
  if (report.commits > 0) {
    const mean = (ms: number) => `${Math.round(ms / report.commits)} мс`
    rows.push([
      'Контрольні точки',
      `${report.commits} ${partsWord(report.commits)} закрито; у середньому ${mean(report.checkpointMs)} на точку, з них запис і підтвердження ${mean(report.commitMs)}`,
    ])
  }
  const stages = [`відео ${seconds(report.videoMs)}`, `збирання ${seconds(report.assembleMs)}`]
  if (report.audioMs > 0) stages.unshift(`звук ${seconds(report.audioMs)}`)
  rows.push(['Етапи', stages.join(', ')])
  const interval = duration === undefined ? null : intervalRow(report, duration)
  if (interval) rows.push(interval)
  return rows
}
