// src/stand/aggregate.ts
import type { RunRecord } from './record.ts'
import { summarize } from './stats.ts'
import type { Summary } from './stats.ts'

export type MetricKey = {
  [K in keyof RunRecord]: RunRecord[K] extends number | null ? K : never
}[keyof RunRecord]

// A figure of the table: how to read it off a record and how to show it.
export interface Metric {
  key: MetricKey
  label: string
  // Multiplied in before showing, and the digits after the point.
  scale: number
  digits: number
}

export const METRICS: Metric[] = [
  { key: 'elapsedMs', label: 'Час експорту, с', scale: 0.001, digits: 1 },
  { key: 'wallMs', label: 'Повний час, с', scale: 0.001, digits: 1 },
  { key: 'fps', label: 'Швидкість, кадр/с', scale: 1, digits: 0 },
  { key: 'realtime', label: 'Від реального часу, ×', scale: 1, digits: 1 },
  { key: 'bytes', label: 'Файл, МБ', scale: 1 / (1024 * 1024), digits: 1 },
  { key: 'peakFrames', label: 'Пік кадрів у конвеєрі', scale: 1, digits: 0 },
  { key: 'limit', label: 'Ліміт у кінці, кадрів', scale: 1, digits: 0 },
  { key: 'memLimit', label: 'Ліміт за пам’яттю N_mem, кадрів', scale: 1, digits: 0 },
  { key: 'budgetMiB', label: 'Бюджет пам’яті, МБ', scale: 1, digits: 0 },
  { key: 'w0Ms', label: 'W₀, мс', scale: 1, digits: 0 },
  { key: 'w0FirstMs', label: 'W₀ першого заміру, мс', scale: 1, digits: 0 },
  { key: 'lambdaFps', label: 'λ, кадр/с', scale: 1, digits: 0 },
  { key: 'probeFps', label: 'Швидкість проби, кадр/с', scale: 1, digits: 0 },
  { key: 'borrowed', label: 'Позичено кредитів', scale: 1, digits: 0 },
  { key: 'floor', label: 'Підлога ліміту, кадрів', scale: 1, digits: 0 },
  { key: 'gateMs', label: 'Ворота без кредиту, мс', scale: 1, digits: 0 },
  { key: 'peakFrameMiB', label: 'Пік пам’яті кадрів, МБ', scale: 1, digits: 0 },
  { key: 'peakHeapMiB', label: 'Пік купи JS, МБ', scale: 1, digits: 0 },
  { key: 'copiedShare', label: 'Скопійовано, %', scale: 100, digits: 0 },
  { key: 'plannedShare', label: 'За планом, %', scale: 100, digits: 0 },
  { key: 'checkpointMs', label: 'Контрольна точка, мс', scale: 1, digits: 0 },
  { key: 'openMs', label: 'Відкриття наступної, мс', scale: 1, digits: 0 },
  { key: 'commits', label: 'Точок', scale: 1, digits: 0 },
  { key: 'journalMiB', label: 'Журнал, МБ', scale: 1, digits: 1 },
  { key: 'waitMs', label: 'Очікування декодера, с', scale: 0.001, digits: 2 },
  { key: 'composeMs', label: 'Малювання кадрів, с', scale: 0.001, digits: 2 },
  { key: 'encodeMs', label: 'У кодувальнику, с', scale: 0.001, digits: 2 },
  { key: 'firstFrameMs', label: 'До першого кадру, мс', scale: 1, digits: 0 },
  { key: 'setupMs', label: 'Підготовка, мс', scale: 1, digits: 0 },
  { key: 'firstItemMs', label: 'До першого елемента, мс', scale: 1, digits: 0 },
  { key: 'firstAddMs', label: 'Перший add кодувальника, мс', scale: 1, digits: 0 },
  { key: 'startRunMs', label: 'Старти сеансів, мс', scale: 1, digits: 0 },
  { key: 'sendMs', label: 'Передача пакетів, с', scale: 0.001, digits: 2 },
  { key: 'readMs', label: 'Читання пакетів, с', scale: 0.001, digits: 2 },
  { key: 'decodeMs', label: 'Декодування, с', scale: 0.001, digits: 2 },
  { key: 'finishMs', label: 'Завершення, мс', scale: 1, digits: 0 },
  { key: 'endRunMs', label: 'Закриття сеансів, мс', scale: 1, digits: 0 },
  { key: 'probeMs', label: 'Пробний сеанс кодувальника, мс', scale: 1, digits: 0 },
  { key: 'scanMs', label: 'Огляд ключових пакетів, мс', scale: 1, digits: 0 },
  { key: 'decodeAskMs', label: 'До першого запиту декодера, мс', scale: 1, digits: 0 },
  { key: 'firstSampleMs', label: 'Перший кадр від декодера, мс', scale: 1, digits: 0 },
  { key: 'longestUiMs', label: 'Найдовша пауза сторінки, мс', scale: 1, digits: 0 },
  { key: 'psnrMean', label: 'PSNR перекодованих, дБ', scale: 1, digits: 1 },
  { key: 'psnrMin', label: 'Найгірший PSNR, дБ', scale: 1, digits: 1 },
  { key: 'ssimMean', label: 'SSIM, середній', scale: 1, digits: 4 },
  { key: 'ssimMin', label: 'SSIM, найгірший', scale: 1, digits: 4 },
  { key: 'identicalShare', label: 'Кадрів без втрат, %', scale: 100, digits: 0 },
  { key: 'crashes', label: 'Обривів', scale: 1, digits: 1 },
  { key: 'freshStarts', label: 'Заново, разів', scale: 1, digits: 1 },
  { key: 'restartMs', label: 'Відновлення, мс', scale: 1, digits: 0 },
]

export const metricOf = (key: string): Metric | undefined => METRICS.find((metric) => metric.key === key)

// The runs that count: finished, and not a warm-up. Conditions keep the order
// in which they first appear.
export function counted(records: RunRecord[]): Map<string, RunRecord[]> {
  const groups = new Map<string, RunRecord[]>()
  for (const record of records) {
    if (!record.ok || record.warmup) continue
    const list = groups.get(record.condition)
    if (list) list.push(record)
    else groups.set(record.condition, [record])
  }
  return groups
}

export function summaryOf(records: RunRecord[], condition: string, key: MetricKey): Summary | null {
  const values = (counted(records).get(condition) ?? [])
    .map((record) => record[key])
    .filter((value): value is number => typeof value === 'number')
  return summarize(values)
}

// How many times a condition failed, warm-ups not counted.
export function failures(records: RunRecord[], condition: string): number {
  return records.filter((record) => record.condition === condition && !record.ok && !record.warmup).length
}

// The ratio of a condition to another, run by run within a round: the two ran
// close in time, so a drift of the machine cancels out of the ratio.
export function pairedRatios(records: RunRecord[], numerator: string, denominator: string, key: MetricKey): number[] {
  const groups = counted(records)
  const top = new Map((groups.get(numerator) ?? []).map((record) => [record.round, record[key]]))
  const ratios: number[] = []
  for (const record of groups.get(denominator) ?? []) {
    const above = top.get(record.round)
    const below = record[key]
    if (typeof above === 'number' && typeof below === 'number' && below !== 0) ratios.push(above / below)
  }
  return ratios
}

export function pairedSummary(records: RunRecord[], numerator: string, denominator: string, key: MetricKey): Summary | null {
  return summarize(pairedRatios(records, numerator, denominator, key))
}

// A figure as text in the metric's units, with a comma as the decimal mark.
export function formatValue(value: number, metric: Metric): string {
  return (value * metric.scale).toFixed(metric.digits).replace('.', ',')
}
