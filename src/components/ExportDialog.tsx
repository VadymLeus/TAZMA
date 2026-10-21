// src/components/ExportDialog.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AUDIO_LABELS, CONTAINER_LABELS, VIDEO_LABELS, availableCodecs } from '../export/codecs.ts'
import type {
  Container,
  ExportMode,
  ExportProject,
  ExportSettings,
  QualityLevel,
} from '../export/types.ts'
import { heightChoices, outputSize } from '../export/geometry.ts'
import { tickCount } from '../export/gifTicks.ts'
import { blockerLines, planSentence } from '../export/planText.ts'
import { planProject } from '../export/selectiveAnalysis.ts'
import type { ProjectPlan } from '../export/selectiveAnalysis.ts'
import {
  GIF_COMFORT_HEIGHT,
  GIF_FPS_CHOICES,
  availableContainers,
  defaultSettings,
  exportFileName,
  normalizeSettings,
  withContainer,
} from '../export/settings.ts'
import type { ContainerChoices } from '../export/settings.ts'
import { suggestionText } from '../export/journalText.ts'
import { estimateRemaining } from '../export/stats.ts'
import { isVideoSettings } from '../export/types.ts'
import { useExportJob } from '../export/useExportJob.ts'
import { formatSpan } from '../media/format.ts'
import { DEFAULT_SEGMENT_SECONDS } from '../resume/cuts.ts'
import {
  DEFAULT_MTBF_MINUTES,
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  parseMinutes,
  parseSegmentSeconds,
} from '../resume/interval.ts'
import { loadMeasurement } from '../resume/measure.ts'
import type { Measurement } from '../resume/measure.ts'
import { suggestSegment } from '../resume/recommend.ts'
import type { FrameSize } from '../project/frame.ts'
import { ResultInfo, progressText } from './ExportResult.tsx'
import FlowControls from './FlowControls.tsx'
import MemoryReport from './MemoryReport.tsx'

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

// Frames times pixels above which a GIF gets very heavy.
const GIF_HEAVY = 100_000_000

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
  const [segmentText, setSegmentText] = useState(String(DEFAULT_SEGMENT_SECONDS))
  const [mtbfText, setMtbfText] = useState(String(DEFAULT_MTBF_MINUTES))
  const [measured, setMeasured] = useState<Measurement | null>(null)
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
  const isGif = effective.container === 'gif'
  const codecs = isVideoSettings(effective) ? choices?.[effective.container] : undefined
  const hasAudio = project.clips.some(
    (clip) => project.sources.find((s) => s.id === clip.sourceId)?.info.audio,
  )
  const audioMissing = !isGif && hasAudio && codecs !== undefined && codecs.audio.length === 0
  const gifFrames = tickCount(total, effective.gifFps)
  const gifHeavy = gifFrames * size.width * size.height > GIF_HEAVY
  const segmentSeconds = parseSegmentSeconds(segmentText)
  const segmentWrong = effective.resumable === true && !isGif && segmentSeconds === null
  const ready = choices !== null && containers.length > 0 && !audioMissing && !segmentWrong

  const { mode, container, videoCodec, quality, height, ignoreColor } = effective
  const phase = state.phase
  useEffect(() => {
    if (open) setMeasured(loadMeasurement(mode))
  }, [open, mode, phase])
  const suggestion = useMemo(() => {
    const minutes = parseMinutes(mtbfText)
    return minutes === null ? null : suggestSegment(minutes, measured)
  }, [mtbfText, measured])
  const { clips, texts, sources } = project
  useEffect(() => {
    if (!open || !ready || mode !== 'selective' || container === 'gif') {
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

  // The settings the export is run with: the length of a part is what the
  // field holds.
  const runSettings: ExportSettings =
    effective.resumable === true && segmentSeconds !== null
      ? { ...effective, segmentSeconds }
      : effective

  function close() {
    if (running) return
    job.reset()
    onClose()
  }

  const progress = state.phase === 'running' ? state.progress : null
  const remaining =
    state.phase === 'running' && progress && (progress.phase ?? 'video') === 'video'
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
          ) : (
            <>
              <label className="field">
                <span>Формат</span>
                <select
                  value={effective.container}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setSettings(
                      withContainer(
                        effective,
                        event.target.value as Container,
                        frame.height > GIF_COMFORT_HEIGHT ? heights : [],
                      ),
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
              {containers.length === 1 && (
                <p className="error">
                  Браузер не вміє кодувати відео, тому доступний лише GIF.
                </p>
              )}
              {isGif ? (
                <GifControls
                  settings={effective}
                  heights={heights}
                  frame={frame}
                  frames={gifFrames}
                  heavy={gifHeavy}
                  hasAudio={hasAudio}
                  change={change}
                />
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
                    <SizeField
                      height={effective.height}
                      heights={heights}
                      frame={frame}
                      onChange={(height) => change({ height })}
                    />
                  </div>
                  <FlowControls settings={effective} change={change} />
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
            </>
          )}

          {choices !== null && !isGif && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={effective.resumable === true}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    change({ resumable: event.target.checked })
                  }
                />
                <span>Відновлюваний експорт (журнал у сховищі браузера)</span>
              </label>
              <p className="muted export-note">
                {effective.mode === 'full'
                  ? 'Закодовані частини відео пишуться в сховище браузера, звук кодується окремим проходом, файл збирається з журналу в кінці.'
                  : 'Частини відео, скопійовані з файлів і закодовані заново, пишуться в сховище браузера, звук кодується окремим проходом, файл збирається з журналу в кінці.'}
              </p>
              {effective.resumable === true && (
                <>
                  <div className="field-row">
                    <label className="field">
                      <span>Довжина частини, с</span>
                      <input
                        type="number"
                        min={MIN_SEGMENT_SECONDS}
                        max={MAX_SEGMENT_SECONDS}
                        step="any"
                        value={segmentText}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setSegmentText(event.target.value)
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Обрив раз на, хв (M)</span>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={mtbfText}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setMtbfText(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={!suggestion}
                    onClick={() => suggestion && setSegmentText(String(suggestion.plan.segment))}
                  >
                    Підібрати за формулою
                  </button>
                  {segmentWrong && (
                    <p className="error export-note">
                      Довжина частини — від {MIN_SEGMENT_SECONDS} до {MAX_SEGMENT_SECONDS} с.
                    </p>
                  )}
                  <p className="muted segment-hint">
                    Після обриву втрачається не більше однієї частини, але кожна точка коштує
                    часу. {suggestion ? suggestionText(suggestion) : 'M — скільки хвилин роботи в середньому між обривами; потрібне додатне число.'}
                  </p>
                </>
              )}
            </>
          )}

          {choices !== null && (
            <label className="check">
              <input
                type="checkbox"
                checked={effective.recordMemory}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  change({ recordMemory: event.target.checked })
                }
              />
              <span>Записувати використання пам’яті під час експорту</span>
            </label>
          )}

          {choices !== null && (
            <label className="check">
              <input
                type="checkbox"
                checked={effective.inWorker !== false}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  change({ inWorker: event.target.checked })
                }
              />
              <span>Виконувати в окремому потоці (інтерфейс не підвисає)</span>
            </label>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready}
              onClick={() => void job.start(project, runSettings)}
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
            {progress ? progressText(progress, remaining) : 'Готую кодувальники…'}
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
          {state.result.settings.container === 'gif' ? (
            <img className="export-video" src={state.url} alt="Результат експорту" />
          ) : (
            <video className="export-video" src={state.url} controls />
          )}
          <ResultInfo result={state.result} />
          {state.result.memory && <MemoryReport trace={state.result.memory} />}
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

interface GifControlsProps {
  settings: ExportSettings
  heights: number[]
  frame: FrameSize
  frames: number
  heavy: boolean
  hasAudio: boolean
  change: (patch: Partial<ExportSettings>) => void
}

function GifControls({ settings, heights, frame, frames, heavy, hasAudio, change }: GifControlsProps) {
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Частота кадрів</span>
          <select
            value={settings.gifFps}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              change({ gifFps: Number(event.target.value) })
            }
          >
            {GIF_FPS_CHOICES.map((fps) => (
              <option key={fps} value={fps}>
                {fps} кадр/с
              </option>
            ))}
          </select>
        </label>
        <SizeField
          height={settings.height}
          heights={heights}
          frame={frame}
          onChange={(height) => change({ height })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.gifDither}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            change({ gifDither: event.target.checked })
          }
        />
        <span>Розсіювання кольорів (плавніші градієнти, файл більший)</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.gifLoop}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            change({ gifLoop: event.target.checked })
          }
        />
        <span>Повторювати без кінця</span>
      </label>
      <p className="muted export-note">
        У GIF ≈ {frames} кадрів, до 256 кольорів на кадр, без звуку
        {hasAudio ? ' (звук проєкту не потрапить у файл)' : ''}.
      </p>
      {heavy && (
        <p className="error export-note">
          Кадрів і пікселів забагато: файл вийде дуже великим. Зменште розмір кадру
          або частоту.
        </p>
      )}
    </>
  )
}

interface SizeFieldProps {
  height: number | null
  heights: number[]
  frame: FrameSize
  onChange: (height: number | null) => void
}

function SizeField({ height, heights, frame, onChange }: SizeFieldProps) {
  return (
    <label className="field">
      <span>Розмір кадру</span>
      <select
        value={height ?? ''}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      >
        <option value="">Як у проєкті ({sizeLabel(outputSize(frame, null))})</option>
        {heights.map((choice) => (
          <option key={choice} value={choice}>
            {sizeLabel(outputSize(frame, choice))}
          </option>
        ))}
      </select>
    </label>
  )
}
