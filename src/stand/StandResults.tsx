// src/stand/StandResults.tsx
import { Fragment } from 'react'
import { failures, formatValue, metricOf, pairedSummary, summaryOf } from './aggregate.ts'
import type { Metric } from './aggregate.ts'
import type { RunRecord } from './record.ts'
import type { Series } from './series.ts'
import type { Summary } from './stats.ts'
import IntervalResults from './IntervalResults.tsx'

const ratio = (value: number) => value.toFixed(3).replace('.', ',')

function rangeText(summary: Summary, metric: Metric): string {
  const median = formatValue(summary.median, metric)
  if (summary.n < 2) return median
  return `${median} (${formatValue(summary.q1, metric)}–${formatValue(summary.q3, metric)})`
}

function ratioText(summary: Summary): string {
  const percent = (summary.median - 1) * 100
  const sign = percent > 0 ? '+' : ''
  const head = `×${ratio(summary.median)} (${sign}${percent.toFixed(1).replace('.', ',')} %)`
  return summary.n < 2 ? head : `${head}, ${ratio(summary.q1)}–${ratio(summary.q3)}`
}

interface StandResultsProps {
  series: Series
  records: RunRecord[]
}

// Medians with the interquartile range for every condition and figure, and the
// ratios of the pairs the series cares about. Warm-ups and failed runs are not
// in the figures.
export default function StandResults({ series, records }: StandResultsProps) {
  const metrics = series.metrics.map(metricOf).filter((metric): metric is Metric => metric !== undefined)
  return (
    <>
      <div className="stand-scroll">
        <table className="stand-table">
          <thead>
            <tr>
              <th>Умова</th>
              <th>Прогонів</th>
              {metrics.map((metric) => (
                <th key={metric.key}>{metric.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.conditions.map((condition) => {
              const failed = failures(records, condition.id)
              const n = summaryOf(records, condition.id, 'elapsedMs')?.n ?? 0
              return (
                <tr key={condition.id}>
                  <td>{condition.label}</td>
                  <td>
                    {n}
                    {failed > 0 && <span className="error"> (збоїв: {failed})</span>}
                  </td>
                  {metrics.map((metric) => {
                    const summary = summaryOf(records, condition.id, metric.key)
                    return <td key={metric.key}>{summary ? rangeText(summary, metric) : '—'}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted export-note">Медіана (перший–третій квартиль). У таблиці лише прогони без прогріву й без збоїв.</p>

      {series.pairs.length > 0 && (
        <dl className="info stand-pairs">
          {series.pairs.map((pair) => (
            <Fragment key={`${pair.numerator}/${pair.denominator}`}>
              <dt>{pair.label}</dt>
              <dd>
                {(pair.keys ?? ['elapsedMs']).map((key) => {
                  const summary = pairedSummary(records, pair.numerator, pair.denominator, key)
                  const metric = metricOf(key)
                  return (
                    <div key={key}>
                      {metric?.label}: {summary ? `${ratioText(summary)}, n = ${summary.n}` : '—'}
                    </div>
                  )
                })}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}

      {series.id === 'interval' && <IntervalResults series={series} records={records} />}
    </>
  )
}
