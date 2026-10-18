import {
  codecLabel,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatFrameRate,
} from '../media/format.ts'
import type { MediaInfo } from '../media/probe.ts'

interface InfoPanelProps {
  info: MediaInfo
}

export default function InfoPanel({ info }: InfoPanelProps) {
  const { video, audio } = info

  return (
    <section className="card">
      <h2>Дані про файл</h2>
      <dl className="info">
        <dt>Файл</dt>
        <dd className="break">{info.fileName}</dd>

        <dt>Розмір</dt>
        <dd>{formatBytes(info.fileSize)}</dd>

        <dt>Контейнер</dt>
        <dd>{info.format}</dd>

        <dt>Тривалість</dt>
        <dd>{formatDuration(info.duration)}</dd>

        <dt>Відео</dt>
        <dd>
          {video ? (
            <>
              {codecLabel(video.codec)}
              {video.codecString && (
                <span className="muted"> · {video.codecString}</span>
              )}
              <br />
              {video.width}×{video.height}
              {video.rotation !== 0 && (
                <span className="muted"> · поворот {video.rotation}°</span>
              )}
              <br />
              {formatFrameRate(video.frameRate)} ·{' '}
              {formatBitrate(video.bitrate)}
              <br />
              <span className="muted">
                {video.frameCount.toLocaleString('uk-UA')} кадрів
              </span>
              {info.videoTrackCount > 1 && (
                <span className="muted">
                  {' '}
                  · ще доріжок: {info.videoTrackCount - 1}
                </span>
              )}
            </>
          ) : (
            <span className="muted">відеодоріжки немає</span>
          )}
        </dd>

        <dt>Звук</dt>
        <dd>
          {audio ? (
            <>
              {codecLabel(audio.codec)}
              {audio.codecString && (
                <span className="muted"> · {audio.codecString}</span>
              )}
              <br />
              {audio.channels} кан. · {audio.sampleRate} Гц ·{' '}
              {formatBitrate(audio.bitrate)}
              {info.audioTrackCount > 1 && (
                <span className="muted">
                  {' '}
                  · ще доріжок: {info.audioTrackCount - 1}
                </span>
              )}
            </>
          ) : (
            <span className="muted">звукової доріжки немає</span>
          )}
        </dd>
      </dl>
    </section>
  )
}
