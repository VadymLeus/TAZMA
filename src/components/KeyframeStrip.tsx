import { formatDuration, formatSeconds } from '../media/format.ts'
import type { KeyframeInfo } from '../media/probe.ts'

const STRIP_WIDTH = 1000

interface KeyframeStripProps {
  keyframes: KeyframeInfo
  /** Total duration in seconds, used to place key frames along the strip. */
  duration: number
  /** Number of video frames, used to express the interval in frames. */
  frameCount: number
}

export default function KeyframeStrip({
  keyframes,
  duration,
  frameCount,
}: KeyframeStripProps) {
  if (keyframes.count === 0) {
    return <p className="muted">Ключових кадрів у файлі не знайдено.</p>
  }

  // At most one tick per pixel column, so long videos stay cheap to draw.
  const columns = new Set<number>()
  if (duration > 0) {
    for (const t of keyframes.timestamps) {
      const x = Math.min(STRIP_WIDTH - 1, Math.floor((t / duration) * STRIP_WIDTH))
      columns.add(Math.max(0, x))
    }
  }

  const framesPerGop = frameCount > 0 ? frameCount / keyframes.count : null

  return (
    <>
      <svg
        className="strip"
        viewBox={`0 0 ${STRIP_WIDTH} 28`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Положення ${keyframes.count} ключових кадрів на часовій шкалі`}
      >
        <rect x="0" y="0" width={STRIP_WIDTH} height="28" className="strip-bg" />
        {[...columns].map((x) => (
          <rect key={x} x={x} y="2" width="2" height="24" className="strip-tick" />
        ))}
      </svg>
      <div className="strip-axis">
        <span>{formatDuration(0)}</span>
        <span>{formatDuration(duration)}</span>
      </div>

      <dl className="info">
        <dt>Кількість</dt>
        <dd>{keyframes.count.toLocaleString('uk-UA')}</dd>

        <dt>Середній інтервал</dt>
        <dd>
          {keyframes.averageInterval === null
            ? '—'
            : formatSeconds(keyframes.averageInterval)}
          {framesPerGop !== null && (
            <span className="muted"> · ≈ {Math.round(framesPerGop)} кадрів</span>
          )}
        </dd>

        <dt>Найбільший інтервал</dt>
        <dd>
          {keyframes.maxInterval === null
            ? '—'
            : formatSeconds(keyframes.maxInterval)}
        </dd>
      </dl>
    </>
  )
}
