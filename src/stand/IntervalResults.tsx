// src/stand/IntervalResults.tsx
import { analyzeInterval } from './analysis.ts'
import type { IntervalRow } from './analysis.ts'
import type { RunRecord } from './record.ts'
import type { Series } from './series.ts'
import type { Summary } from './stats.ts'

const decimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',')
const intervalText = (interval: { work: number; timeline: number }) =>
  `${decimal(interval.work, 2)} с роботи ≈ ${decimal(interval.timeline, 1)} с таймлайну`
const percent = (value: number) => `${decimal(value * 100, 1)} %`

function range(summary: Summary | null, show: (value: number) => string): string {
  if (!summary) return '—'
  const median = show(summary.median)
  return summary.n < 2 ? median : `${median} (${show(summary.q1)}–${show(summary.q3)})`
}

function rowCells(row: IntervalRow, best: boolean) {
  return (
    <tr key={row.condition} className={best ? 'stand-best' : undefined}>
      <td>{decimal(row.interval, row.interval < 1 ? 2 : 1)}</td>
      <td>{decimal(row.work, 2)}</td>
      <td>{row.commits === null ? '—' : decimal(row.commits, 0)}</td>
      <td>{range(row.overhead, percent)}</td>
      <td>{row.n}</td>
      <td>{range(row.wall, (value) => decimal(value, 1))}</td>
      <td>{range(row.crashes, (value) => decimal(value, 1))}</td>
      <td>
        {row.wasteMean === null ? '—' : `${percent(row.wasteMean)}${row.wasteSe === null ? '' : ` ± ${percent(row.wasteSe)}`}`}
        {row.waste && <span className="muted"> (медіана {percent(row.waste.median)})</span>}
      </td>
      <td>{row.young === null ? '—' : percent(row.young)}</td>
      <td>{row.exact === null ? '—' : percent(row.exact)}</td>
    </tr>
  )
}

interface IntervalResultsProps {
  series: Series
  records: RunRecord[]
}

// The sweep of the checkpoint interval beside what the formula says: measured
// waste over the plain export for each part length, Young's waste for the
// measured checkpoint cost, and the exact waste that also counts the restart.
export default function IntervalResults({ series, records }: IntervalResultsProps) {
  const mtbfMs = series.conditions.find((condition) => condition.crashMeanMs !== undefined)?.crashMeanMs
  const analysis = mtbfMs === undefined ? null : analyzeInterval(records, series.conditions, mtbfMs)
  if (!analysis) {
    return <p className="muted export-note">Щойно виконається хоч один прогін без журналу й обривів, тут з’явиться порівняння з формулою.</p>
  }
  const best = analysis.rows.find((row) => row.condition === analysis.best)
  const young = analysis.young
  const exact = analysis.exact
  const verdict = analysis.verdict
  const formulaRow = verdict ? analysis.rows.find((row) => row.condition === verdict.formula) : undefined
  return (
    <>
      <dl className="info stand-pairs">
        <dt>Без журналу й обривів</dt>
        <dd>
          {decimal(analysis.plain, 1)} с, швидкість ×{decimal(analysis.speed, 1)} від реального часу
        </dd>
        <dt>Середній проміжок між обривами M</dt>
        <dd>{decimal(analysis.mtbf, 1)} с</dd>
        <dt>Ціна точки t_c, яку звітує експорт</dt>
        <dd>{analysis.cost === null ? '—' : `${decimal(analysis.cost * 1000, 0)} мс (медіана за прогонами)`}</dd>
        <dt>Ціна точки за додатковим часом журналу</dt>
        <dd>
          {analysis.effective === null
            ? '—'
            : analysis.effective.perCommit > 0
              ? `${decimal(analysis.effective.perCommit * 1000, 0)} мс на точку і ще ${decimal(analysis.effective.fixed * 1000, 0)} мс разом`
              : `точки не розрізнити, журнал додає ${decimal(analysis.effective.fixed * 1000, 0)} мс разом`}
        </dd>
        <dt>Відновлення R</dt>
        <dd>
          {analysis.restart === null
            ? 'жодного обриву не було'
            : `${decimal(analysis.restart * 1000, 0)} мс від обриву до першого кроку роботи`}
        </dd>
        {young && (
          <>
            <dt>Інтервал за τ = √(2·t_c·M), t_c експорту</dt>
            <dd>{intervalText(young)}</dd>
          </>
        )}
        {analysis.youngEffective && (
          <>
            <dt>Той самий вираз із ціною за додатковим часом</dt>
            <dd>{intervalText(analysis.youngEffective)}</dd>
          </>
        )}
        {exact && (
          <>
            <dt>Оптимум точної моделі</dt>
            <dd>{intervalText(exact)}</dd>
          </>
        )}
        {best?.wasteMean != null && (
          <>
            <dt>Найменші виміряні втрати</dt>
            <dd>
              частина {decimal(best.interval, 1)} с: {percent(best.wasteMean)} (середнє)
              {best.exact !== null && `, за точною моделлю ${percent(best.exact)}`}
            </dd>
          </>
        )}
        {verdict && formulaRow && (
          <>
            <dt>Частина, найближча до формули</dt>
            <dd>
              {decimal(formulaRow.interval, 1)} с{' '}
              {verdict.difference === 0
                ? 'і є найкращою виміряною'
                : `програє найкращій на ${decimal(verdict.difference * 100, 1)} ± ${decimal(verdict.se * 100, 1)} п. п. (за ${verdict.n} колами)`}
            </dd>
          </>
        )}
      </dl>
      <div className="stand-scroll">
        <table className="stand-table">
          <thead>
            <tr>
              <th>Частина, с таймлайну</th>
              <th>τ, с роботи</th>
              <th>Точок</th>
              <th>Журнал без обривів: понад норму</th>
              <th>Прогонів</th>
              <th>З обривами: повний час, с</th>
              <th>Обривів</th>
              <th>Втрати виміряні</th>
              <th>За Янгом</th>
              <th>За точною моделлю</th>
            </tr>
          </thead>
          <tbody>{analysis.rows.map((row) => rowCells(row, row.condition === analysis.best))}</tbody>
        </table>
      </div>
      <p className="muted export-note">
        «Понад норму» — час журналу без обривів проти експорту без журналу з того ж кола. Втрати — повний час з обривами й
        відновленнями проти того ж експорту без журналу, мінус 1: середнє за колами ± стандартна похибка (медіана в
        дужках), бо модель передбачає саме середнє. Янг: t_c/τ + τ/(2M) із ціною, яку звітує експорт. Точна модель
        (Дейлі) бере ціну за додатковим часом журналу, відновлення R і можливість обриву під час відновлення. Обриви в
        колі однакові для всіх довжин частини.
      </p>
    </>
  )
}
