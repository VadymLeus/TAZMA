// src/components/VideoPreview.tsx
import type { RefObject } from 'react'
import { formatDuration } from '../media/format.ts'

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>
  hasClips: boolean
  playing: boolean
  playhead: number
  total: number
  error: string | null
  onToggle: () => void
}

export default function VideoPreview({
  videoRef,
  hasClips,
  playing,
  playhead,
  total,
  error,
  onToggle,
}: VideoPreviewProps) {
  return (
    <section className="card">
      <div className="screen">
        <video ref={videoRef} playsInline preload="auto" />
        {!hasClips && <div className="screen-empty">Таймлайн порожній</div>}
      </div>
      {error && <p className="notice">{error}</p>}
      <div className="transport">
        <button
          type="button"
          className="btn btn-icon"
          disabled={!hasClips}
          onClick={onToggle}
          title="Відтворити / пауза (Пробіл)"
          aria-label={playing ? 'Пауза' : 'Відтворити'}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            {playing ? (
              <path d="M3 2h4v12H3zM9 2h4v12H9z" fill="currentColor" />
            ) : (
              <path d="M4 2l10 6-10 6z" fill="currentColor" />
            )}
          </svg>
        </button>
        <span className="time">
          {formatDuration(playhead)} / {formatDuration(total)}
        </span>
      </div>
    </section>
  )
}
