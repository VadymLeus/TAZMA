// src/components/Timeline.tsx
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { formatDuration } from '../media/format.ts'
import { clipLength } from '../project/timeline.ts'
import type { Clip, Source } from '../project/types.ts'

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
const MIN_TICK_GAP = 80
const MAX_TICKS = 600

function tickLabel(seconds: number, step: number): string {
  const tenthsTotal = Math.round(seconds * 10)
  const tenths = tenthsTotal % 10
  const whole = Math.floor(tenthsTotal / 10)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  return step < 1 ? `${base}.${tenths}` : base
}

interface TimelineProps {
  clips: Clip[]
  sources: Source[]
  playhead: number
  total: number
  zoom: number
  selectedClipId: string | null
  onSeek: (time: number) => void
  onSelect: (clipId: string | null) => void
}

export default function Timeline({
  clips,
  sources,
  playhead,
  total,
  zoom,
  selectedClipId,
  onSeek,
  onSelect,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [viewWidth, setViewWidth] = useState(0)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewWidth(element.clientWidth))
    observer.observe(element)
    setViewWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const contentWidth = Math.floor(viewWidth * zoom)
  const pps = total > 0 ? contentWidth / total : 0

  // Keep the playhead in view while the timeline is zoomed in.
  useEffect(() => {
    const element = scrollRef.current
    if (!element || dragging.current || pps === 0) return
    const x = playhead * pps
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = Math.max(0, x - element.clientWidth / 2)
    }
  }, [playhead, pps])

  let step = TICK_STEPS.find((s) => s * pps >= MIN_TICK_GAP) ?? 7200
  while (total / step > MAX_TICKS) step *= 2
  const ticks: number[] = []
  if (pps > 0) {
    for (let t = 0; t < total; t += step) ticks.push(t)
  }

  const hueOf = new Map(sources.map((s, i) => [s.id, (i * 67) % 360]))
  const nameOf = new Map(sources.map((s) => [s.id, s.info.fileName]))

  function timeAt(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.min(Math.max((event.clientX - rect.left) / pps, 0), total)
  }

  function handleDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pps === 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    const clipElement = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-clip-id]',
    )
    if (clipElement) onSelect(clipElement.dataset.clipId ?? null)
    onSeek(timeAt(event))
  }

  function handleMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current) onSeek(timeAt(event))
  }

  function handleUp() {
    dragging.current = false
  }

  if (clips.length === 0) {
    return (
      <div className="timeline-scroll" ref={scrollRef}>
        <p className="muted timeline-empty">
          Таймлайн порожній: додайте кліп кнопкою +
        </p>
      </div>
    )
  }

  return (
    <div className="timeline-scroll" ref={scrollRef}>
      <div
        className="timeline-content"
        style={{ width: contentWidth }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        <div className="ruler">
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: t * pps }}>
              {tickLabel(t, step)}
            </span>
          ))}
        </div>
        <div className="track">
          {clips.map((clip) => (
            <div
              key={clip.id}
              data-clip-id={clip.id}
              className={clip.id === selectedClipId ? 'clip clip-selected' : 'clip'}
              style={
                {
                  width: clipLength(clip) * pps,
                  '--hue': hueOf.get(clip.sourceId) ?? 0,
                } as CSSProperties
              }
              title={nameOf.get(clip.sourceId)}
            >
              <span className="clip-name">{nameOf.get(clip.sourceId)}</span>
              <span className="clip-length">{formatDuration(clipLength(clip))}</span>
            </div>
          ))}
        </div>
        <div className="playhead" style={{ left: playhead * pps }} />
      </div>
    </div>
  )
}
