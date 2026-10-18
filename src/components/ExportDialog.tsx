// src/components/ExportDialog.tsx
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AUDIO_LABELS, CONTAINER_LABELS, VIDEO_LABELS, availableCodecs } from '../export/codecs.ts'
import type {
  Container,
  ExportMode,
  ExportProject,
  ExportResult,
  ExportSettings,
  QualityLevel,
} from '../export/types.ts'
import { heightChoices, outputSize } from '../export/geometry.ts'
import { blockerLines, planSentence, statsSentence } from '../export/planText.ts'
import { planProject } from '../export/selectiveAnalysis.ts'
import type { ProjectPlan } from '../export/selectiveAnalysis.ts'
import {
  availableContainers,
  defaultSettings,
  exportFileName,
  normalizeSettings,
  withContainer,
} from '../export/settings.ts'
import type { ContainerChoices } from '../export/settings.ts'
import { estimateRemaining, formatRemaining, resultSpeed } from '../export/stats.ts'
import { useExportJob } from '../export/useExportJob.ts'
import { formatBytes, formatSpan } from '../media/format.ts'
import type { FrameSize } from '../project/frame.ts'

interface ExportDialogProps {
  open: boolean
  project: ExportProject
  frame: FrameSize
  total: number
  onClose: () => void
}

const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: 'Низька (менший файл)',
  medium: 'Середня',
  high: 'Висока (більший файл)',
}

const MODE_LABELS: Record<ExportMode, string> = {
  selective: 'Вибірковий: копіювати незмінене',
  full: 'Повне перекодування',
}

type PlanState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; plan: ProjectPlan }
  | { phase: 'error'; message: string }

const sizeLabel = (size: FrameSize) => `${size.width}×${size.height}`

export default function ExportDialog({
  open,
  project,
  frame,
  total,
  onClose,
}: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [settings, setSettings] = useState<ExportSettings>(defaultSettings)
  const [choices, setChoices] = useState<ContainerChoices | null>(null)
  const [planState, setPlanState] = useState<PlanState>({ phase: 'idle' })
  const job = useExportJob()
  const { state } = job
  const running = state.phase === 'running'

  const heights = useMemo(() => heightChoices(frame), [frame])
  const size = outputSize(frame, settings.height)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    let current = true
    Promise.all([
      availableCodecs('mp4', size),
      availableCodecs('webm', size),
    ]).then(([mp4, webm]) => {
      if (current) setChoices({ mp4, webm })
    })
    return () => {
      current = false
    }
  }, [open, size.width, size.height])

  const effective = choices ? normalizeSettings(settings, choices, heights) : settings
  const containers = choices ? availableContainers(choices) : []
  const codecs = choices?.[effective.container]
  const hasAudio = project.clips.some(
    (clip) => project.sources.find((s) => s.id === clip.sourceId)?.info.audio,
  )
  const audioMissing = hasAudio && codecs !== undefined && codecs.audio.length === 0
  const ready = choices !== null && containers.length > 0 && !audioMissing

  const { mode, container, videoCodec, quality, height, ignoreColor } = effective
  const { clips, texts, sources } = project
  useEffect(() => {
    if (!open || !ready || mode !== 'selective') {
      setPlanState({ phase: 'idle' })
      return
    }
    const controller = new AbortController()
    setPlanState({ phase: 'loading' })
    const timer = setTimeout(() => {
      planProject({ clips, texts, sources }, { ...effective, mode, container, videoCodec, quality, height, ignoreColor }, controller.signal).then(
        (plan) => setPlanState({ phase: 'ready', plan }),
        (error: unknown) => {
          if (controller.signal.aborted) return
          setPlanState({
            phase: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        },
      )
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, ready, mode, container, videoCodec, quality, height, ignoreColor, clips, texts, sources])

  function change(patch: Partial<ExportSettings>) {
    setSettings({ ...effective, ...patch })
  }

  function close() {
    if (running) return
    job.reset()
    onClose()
  }

  const progress = state.phase === 'running' ? state.progress : null
  const remaining =
    state.phase === 'running' && progress
      ? estimateRemaining(progress.time, progress.total, performance.now() - state.startedAt)
      : null

  return (
    <dialog
      ref={dialogRef}
      className="export-dialog"
      aria-labelledby="export-title"
      onCancel={(event: { preventDefault(): void }) => {
        event.preventDefault()
        close()
      }}
    >
      <h2 id="export-title">Експорт</h2>

      {open && state.phase === 'idle' && (
        <>
          <p className="muted export-summary">
            Тривалість {formatSpan(total)} · кадр проєкту {sizeLabel(frame)}
          </p>

          {choices === null ? (
            <p className="muted">Перевіряю, які кодеки підтримує браузер…</p>
          ) : containers.length === 0 ? (
            <p className="error">Браузер не вміє кодувати відео у доступні формати.</p>
          ) : (
            <>
              <label className="field">
                <span>Режим</span>
                <select
                  value={effective.mode}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    change({ mode: event.target.value as ExportMode })
                  }
                >
                  {(Object.keys(MODE_LABELS) as ExportMode[]).map((value) => (
                    <option key={value} value={value}>
                      {MODE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Контейнер</span>
                <select
                  value={effective.container}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setSettings(
                      withContainer(effective, event.target.value as Container),
                    )
                  }
                >
                  {containers.map((container) => (
                    <option key={container} value={container}>
                      {CONTAINER_LABELS[container]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Відеокодек</span>
                  <select
                    value={effective.videoCodec}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      change({ videoCodec: event.target.value as ExportSettings['videoCodec'] })
                    }
                  >
                    {codecs?.video.map((codec) => (
                      <option key={codec} value={codec}>
                        {VIDEO_LABELS[codec] ?? codec}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Аудіокодек</span>
                  <select
                    value={effective.audioCodec}
                    disabled={!codecs || codecs.audio.length === 0}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      change({ audioCodec: event.target.value as ExportSettings['audioCodec'] })
                    }
                  >
                    {codecs?.audio.map((codec) => (
                      <option key={codec} value={codec}>
                        {AUDIO_LABELS[codec] ?? codec}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  <span>Якість</span>
                  <select
                    value={effective.quality}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      change({ quality: event.target.value as QualityLevel })
                    }
                  >
                    {(Object.keys(QUALITY_LABELS) as QualityLevel[]).map((level) => (
                      <option key={level} value={level}>
                        {QUALITY_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Розмір кадру</span>
                  <select
                    value={effective.height ?? ''}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      change({
                        height: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">Як у проєкті ({sizeLabel(outputSize(frame, null))})</option>
                    {heights.map((height) => (
                      <option key={height} value={height}>
                        {sizeLabel(outputSize(frame, height))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {audioMissing && (
                <p className="error">
                  Браузер не вміє кодувати звук у цьому контейнері, а в проєкті він є.
                </p>
              )}
              {effective.mode === 'selective' && (
                <>
                  <PlanNote state={planState} project={project} />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={effective.ignoreColor}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        change({ ignoreColor: event.target.checked })
                      }
                    />
                    <span>Не звіряти колірний простір</span>
                  </label>
                  <p className="muted export-note">
                    Якщо файл і кодувальник заявляють різні колірні простори, на стиках
                    скопійованих і перерахованих ділянок можливий зсув відтінків.
                  </p>
                </>
              )}
              <p className="muted export-note">
                У списках лише те, що цей браузер уміє кодувати. Звук завжди
                кодується заново.
              </p>
            </>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready}
              onClick={() => void job.start(project, effective)}
            >
              Експортувати
            </button>
          </div>
        </>
      )}

      {open && state.phase === 'running' && (
        <>
          <progress
            className="export-progress"
            max={progress?.total || total || 1}
            value={progress?.time ?? 0}
          />
          <p className="export-status" role="status">
            {progress
              ? `Закодовано ${formatSpan(progress.time)} з ${formatSpan(progress.total)} · ${progress.frames} кадрів${
                  remaining !== null ? ` · залишилось ${formatRemaining(remaining)}` : ''
                }`
              : 'Готую кодувальники…'}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={job.cancel}>
              Скасувати
            </button>
          </div>
        </>
      )}

      {open && state.phase === 'done' && (
        <>
          <video className="export-video" src={state.url} controls />
          <ResultInfo result={state.result} />
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={job.reset}>
              Налаштування
            </button>
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
            <a
              className="btn btn-primary"
              href={state.url}
              download={exportFileName(state.result.settings.container)}
            >
              Зберегти
            </a>
          </div>
        </>
      )}

      {open && state.phase === 'error' && (
        <>
          <p className="error" role="alert">
            Не вдалося експортувати: {state.message}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
            <button type="button" className="btn" onClick={job.reset}>
              Назад
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}

function ResultInfo({ result }: { result: ExportResult }) {
  const speed = resultSpeed(result)
  const { settings } = result
  const rows: [string, string][] = [
    ['Файл', formatBytes(result.bytes)],
    [
      'Формат',
      `${CONTAINER_LABELS[settings.container]} · ${VIDEO_LABELS[settings.videoCodec] ?? settings.videoCodec}${
        result.hasAudio
          ? ` + ${AUDIO_LABELS[settings.audioCodec] ?? settings.audioCodec}`
          : ', без звуку'
      }`,
    ],
    ['Кадр', `${result.width}×${result.height}, ${result.frames} кадрів`],
    ['Режим', statsSentence(result.stats)],
    ['Тривалість', formatSpan(result.duration)],
    ['Час кодування', formatSpan(result.elapsedMs / 1000)],
    [
      'Швидкість',
      `${Math.round(speed.framesPerSecond)} кадр/с · ×${speed.realtime.toFixed(1).replace('.', ',')} від реального часу`,
    ],
  ]
  return (
    <dl className="info export-result">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function PlanNote({ state, project }: { state: PlanState; project: ExportProject }) {
  if (state.phase === 'idle') return null
  if (state.phase === 'loading') {
    return <p className="muted export-plan">Аналізую ключові кадри файлів…</p>
  }
  if (state.phase === 'error') {
    return <p className="error export-plan">Не вдалося скласти план: {state.message}</p>
  }
  const nameOf = (sourceId: string) =>
    project.sources.find((source) => source.id === sourceId)?.info.fileName ?? sourceId
  const lines = blockerLines(
    state.plan.blockers,
    nameOf,
    (sourceId) => state.plan.streams.get(sourceId) ?? null,
    state.plan.target,
  )
  return (
    <div className="export-plan" role="status">
      <p>{planSentence(state.plan.summary)}</p>
      {lines.length > 0 && (
        <ul className="export-blockers">
          {lines.map((line) => (
            <li key={line.headline}>
              {line.headline}
              {line.details.length > 0 && (
                <ul className="export-details">
                  {line.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
