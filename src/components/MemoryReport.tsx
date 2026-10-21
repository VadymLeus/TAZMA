// src/components/MemoryReport.tsx
import { useEffect, useState } from 'react'
import type { PointerEvent } from 'react'
import {
  formatAxisSeconds,
  formatAxisTicks,
  nearestIndex,
  niceCeil,
  tickValues,
} from '../diagnostics/chartMath.ts'
import { traceToCsv } from '../diagnostics/memoryTrace.ts'
import type { MemoryTrace } from '../diagnostics/memoryTrace.ts'
import { formatBytes, framesText } from '../media/format.ts'

const WIDTH = 480
const HEIGHT = 128
const LEFT = 50
const MIB = 1024 * 1024
const RIGHT = 14
const TOP = 10
const BOTTOM = 22

interface LineChartProps {
  title: string
  xs: number[]
  ys: number[]
  // A dashed line over the chart, e.g. the frame limit; null where there is none.
  limits?: (number | null)[]
  whole: boolean
  tick: (value: number) => string
  peakText: string
  readout: (index: number) => string
}

// One series against time: a 2 px line over a faint wash, hairline grid, the
// end marked with a dot, and a readout of the point under the pointer.
function LineChart({ title, xs, ys, limits, whole, tick, peakText, readout }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const xMax = Math.max(xs[xs.length - 1] ?? 0, 0.001)
  const drawn = (limits ?? []).map((value) => (value !== null && Number.isFinite(value) ? value : null))
  const tallest = drawn.reduce<number>((max, value) => Math.max(max, value ?? 0), 0)
  const yMax = niceCeil(Math.max(ys.reduce((max, y) => Math.max(max, y), 0), tallest))
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const sx = (x: number) => LEFT + (x / xMax) * plotWidth
  const sy = (y: number) => TOP + (1 - y / yMax) * plotHeight
  const points = xs.map((x, i) => `${sx(x).toFixed(1)} ${sy(ys[i] as number).toFixed(1)}`)
  const line = points.length > 0 ? `M${points.join('L')}` : ''
  const area = points.length > 0 ? `${line}L${sx(xMax).toFixed(1)} ${sy(0)}L${sx(xs[0] ?? 0).toFixed(1)} ${sy(0)}Z` : ''
  const last = xs.length - 1
  const limitPath = drawn
    .map((value, i) =>
      value === null ? null : `${sx(xs[i] as number).toFixed(1)} ${sy(value).toFixed(1)}`,
    )
    .filter((point): point is string => point !== null)
  const limitLine = limitPath.length > 1 ? `M${limitPath.join('L')}` : ''

  function move(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const x = ((event.clientX - box.left) / box.width) * WIDTH
    setHover(nearestIndex(xs, ((x - LEFT) / plotWidth) * xMax))
  }

  const shown = hover !== null && hover < xs.length ? hover : null
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span>{title}</span>
        <span className="chart-read">
          {shown !== null ? `${formatAxisSeconds(xs[shown] as number)}: ${readout(shown)}` : peakText}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${title}: ${peakText}`}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
      >
        {tickValues(yMax, whole).map((value) => (
          <g key={value}>
            <line className="chart-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={sy(value)} y2={sy(value)} />
            <text className="chart-tick" x={LEFT - 6} y={sy(value) + 4} textAnchor="end">
              {tick(value)}
            </text>
          </g>
        ))}
        {(() => {
          const values = [0, xMax / 2, xMax]
          const labels = formatAxisTicks(values)
          return values.map((value, i) => (
            <text
              key={i}
              className="chart-tick"
              x={sx(value)}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            >
              {labels[i]}
            </text>
          ))
        })()}
        <path className="chart-area" d={area} />
        {limitLine && <path className="chart-limit" d={limitLine} />}
        <path className="chart-line" d={line} />
        {last >= 0 && (
          <circle
            className="chart-dot"
            cx={sx(xs[last] as number)}
            cy={sy(ys[last] as number)}
            r={4}
          />
        )}
        {shown !== null && (
          <>
            <line
              className="chart-cross"
              x1={sx(xs[shown] as number)}
              x2={sx(xs[shown] as number)}
              y1={TOP}
              y2={sy(0)}
            />
            <circle
              className="chart-dot"
              cx={sx(xs[shown] as number)}
              cy={sy(ys[shown] as number)}
              r={4}
            />
          </>
        )}
      </svg>
    </figure>
  )
}

export default function MemoryReport({ trace }: { trace: MemoryTrace }) {
  const [csvUrl, setCsvUrl] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([traceToCsv(trace)], { type: 'text/csv' }))
    setCsvUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [trace])

  const { points } = trace
  const xs = points.map((p) => p.ms / 1000)
  const heap = trace.peakHeapBytes !== null
  const limited = points.some((p) => p.credits !== null)
  const finalLimit = [...points].reverse().find((p) => p.limit !== null)?.limit ?? null
  const peakCredits = points.reduce((max, p) => Math.max(max, p.credits ?? 0), 0)
  return (
    <details className="memory-report">
      <summary>
        Пам’ять під час експорту · пік {framesText(trace.peakFrames)} (≈ {formatBytes(trace.peakFrameBytes)})
      </summary>
      <p className="muted export-note">
        Кадри рахуються скрізь, де вони відкриті: у декодері, у чергах бібліотеки, перед
        кодувальником. На графіку найбільше значення за кожні 100 мс.
        {limited
          ? ' «Кадри в конвеєрі» — це кредити: кадр від входу в декодер до готового пакета кодувальника; пунктир — ліміт N.'
          : ''}{' '}
        Усього відкрито за експорт {framesText(trace.framesOpened)}
        {trace.framesLeft > 0 ? `, після завершення лишилось незакритих: ${trace.framesLeft}` : ', усі закрито'}.
      </p>
      {limited && (
        <LineChart
          title="Кадри в конвеєрі"
          xs={xs}
          ys={points.map((p) => p.credits ?? 0)}
          limits={points.map((p) => p.limit)}
          whole
          tick={(value) => String(value)}
          peakText={`пік ${framesText(peakCredits)}${finalLimit !== null ? `, ліміт N = ${finalLimit}` : ''}`}
          readout={(i) =>
            `${framesText(points[i]?.credits ?? 0)}${points[i]?.limit != null ? `, ліміт ${points[i]?.limit}` : ''}`
          }
        />
      )}
      <LineChart
        title="Кадри в пам’яті"
        xs={xs}
        ys={points.map((p) => p.frames)}
        whole
        tick={(value) => String(value)}
        peakText={`пік ${framesText(trace.peakFrames)}, ≈ ${formatBytes(trace.peakFrameBytes)}`}
        readout={(i) => `${framesText(points[i]?.frames ?? 0)}, ≈ ${formatBytes(points[i]?.frameBytes ?? 0)}`}
      />
      {heap && (
        <LineChart
          title="Купа JavaScript"
          xs={xs}
          ys={points.map((p) => (p.heapBytes ?? 0) / MIB)}
          whole={false}
          tick={(value) => `${value} МБ`}
          peakText={`пік ${formatBytes(trace.peakHeapBytes ?? 0)}`}
          readout={(i) => formatBytes(points[i]?.heapBytes ?? 0)}
        />
      )}
      {heap && (
        <p className="muted export-note">
          Купа JavaScript не включає пікселі кадрів, але включає буфери закодованих даних і сміття,
          яке ще не прибрано: під час копіювання пакетів вона росте, хоча кадрів немає.
        </p>
      )}
      {csvUrl && (
        <a className="btn" href={csvUrl} download="tazma-memory.csv">
          Зберегти замір (CSV)
        </a>
      )}
    </details>
  )
}
