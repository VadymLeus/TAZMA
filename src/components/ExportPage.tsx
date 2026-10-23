// src/components/ExportPage.tsx
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
import { planProject } from '../export/selectiveAnalysis.ts'
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
import type { ExportBusy } from './PageBar.tsx'
import PlanNote from './PlanNote.tsx'
import type { PlanState } from './PlanNote.tsx'

interface ExportPageProps {
  // The page is on screen. It stays mounted when it is not, so that a job in
  // progress keeps going while the editor is used.
  active: boolean
  project: ExportProject
  frame: FrameSize
  total: number
  onBusy: (busy: ExportBusy) => void
  onSettled: () => void
  onOpenEditor: () => void
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

const sizeLabel = (size: FrameSize) => `${size.width}×${size.height}`

// Frames times pixels above which a GIF gets very heavy.
const GIF_HEAVY = 100_000_000

export default function ExportPage({
  active,
  project,
  frame,
  total,
  onBusy,
  onSettled,
  onOpenEditor,
}: ExportPageProps) {
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
    if (!active) return
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
  }, [active, size.width, size.height])

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
  const noClips = total <= 0
  const ready = choices !== null && containers.length > 0 && !audioMissing && !segmentWrong && !noClips

  const { mode, container, videoCodec, quality, height, ignoreColor } = effective
  const phase = state.phase
  useEffect(() => {
    if (active) setMeasured(loadMeasurement(mode))
  }, [active, mode, phase])
  const suggestion = useMemo(() => {
    const minutes = parseMinutes(mtbfText)
    return minutes === null ? null : suggestSegment(minutes, measured)
  }, [mtbfText, measured])
  const { clips, texts, sources } = project
  useEffect(() => {
    if (!active || !ready || mode !== 'selective' || container === 'gif') {
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
  }, [active, ready, mode, container, videoCodec, quality, height, ignoreColor, clips, texts, sources])

  function change(patch: Partial<ExportSettings>) {
    setSettings({ ...effective, ...patch })
  }

  // The settings the export is run with: the length of a part is what the
  // field holds.
  const runSettings: ExportSettings =
    effective.resumable === true && segmentSeconds !== null
      ? { ...effective, segmentSeconds }
      : effective

  const progress = state.phase === 'running' ? state.progress : null
  const remaining =
    state.phase === 'running' && progress && (progress.phase ?? 'video') === 'video'
      ? estimateRemaining(progress.time, progress.total, performance.now() - state.startedAt)
      : null
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.floor((progress.time / progress.total) * 100))
      : 0

  // The tab bar shows the job; the page above it learns when a job is over,
  // because it ends with a journal that is no longer waiting.
  useEffect(() => {
    onBusy({ phase: state.phase, percent })
  }, [state.phase, percent, onBusy])
  const wasRunning = useRef(false)
  useEffect(() => {
    if (state.phase === 'running') {
      wasRunning.current = true
      return
    }
    if (wasRunning.current) {
      wasRunning.current = false
      onSettled()
    }
  }, [state.phase, onSettled])

  return (
    <div className="export-page">
      <div className="export-side">
        <div className="export-scroll">
          <h2 className="page-title">Експорт</h2>
          <p className="muted export-summary">
            Тривалість {formatSpan(total)} · кадр проєкту {sizeLabel(frame)}
          </p>

          {noClips ? (
            <div className="notice">
              <p>На таймлайні немає кліпів, експортувати нічого.</p>
              <button type="button" className="btn" onClick={onOpenEditor}>
                До редактора
              </button>
            </div>
          ) : choices === null ? (
            <p className="muted">Перевіряю, які кодеки підтримує браузер…</p>
          ) : (
            <fieldset className="export-fields" disabled={running}>
              <section className="group">
                <h3>Основне</h3>
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
                    {containers.map((choice) => (
                      <option key={choice} value={choice}>
                        {CONTAINER_LABELS[choice]}
                      </option>
                    ))}
                  </select>
                </label>
                {containers.length === 1 && (
                  <p className="error">Браузер не вміє кодувати відео, тому доступний лише GIF.</p>
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
                        onChange={(next) => change({ height: next })}
                      />
                    </div>
                    {audioMissing && (
                      <p className="error">
                        Браузер не вміє кодувати звук у цьому контейнері, а в проєкті він є.
                      </p>
                    )}
                    {effective.mode === 'selective' && (
                      <>
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
                      У списках лише те, що цей браузер уміє кодувати. Звук завжди кодується заново.
                    </p>
                  </>
                )}
              </section>

              {!isGif && (
                <section className="group">
                  <h3>Надійність</h3>
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
                        часу.{' '}
                        {suggestion
                          ? suggestionText(suggestion)
                          : 'M — скільки хвилин роботи в середньому між обривами; потрібне додатне число.'}
                      </p>
                    </>
                  )}
                </section>
              )}

              <details className="group group-more">
                <summary>Додатково (для замірів)</summary>
                {!isGif && <FlowControls settings={effective} change={change} />}
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
              </details>
            </fieldset>
          )}
        </div>

        {!noClips && (
          <div className="export-actions">
            {running ? (
              <button type="button" className="btn" onClick={job.cancel}>
                Скасувати
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!ready}
                onClick={() => void job.start(project, runSettings)}
              >
                Експортувати
              </button>
            )}
          </div>
        )}
      </div>

      <div className="export-main">
        {state.phase === 'idle' && !noClips && choices !== null && (
          <section className="card">
            <h2>Що буде записано</h2>
            <dl className="info">
              <dt>Файл</dt>
              <dd>{exportFileName(effective.container)}</dd>
              <dt>Кадр</dt>
              <dd>{sizeLabel(size)}</dd>
              {isGif ? (
                <>
                  <dt>Частота</dt>
                  <dd>{effective.gifFps} кадр/с, ≈ {gifFrames} кадрів</dd>
                  <dt>Звук</dt>
                  <dd>немає</dd>
                </>
              ) : (
                <>
                  <dt>Режим</dt>
                  <dd>{MODE_LABELS[effective.mode]}</dd>
                  <dt>Відео</dt>
                  <dd>
                    {VIDEO_LABELS[effective.videoCodec] ?? effective.videoCodec} ·{' '}
                    {QUALITY_LABELS[effective.quality]}
                  </dd>
                  <dt>Звук</dt>
                  <dd>
                    {hasAudio
                      ? (AUDIO_LABELS[effective.audioCodec] ?? effective.audioCodec)
                      : 'у проєкті звуку немає'}
                  </dd>
                  <dt>Журнал</dt>
                  <dd>{effective.resumable === true ? 'так, експорт можна буде продовжити' : 'ні'}</dd>
                </>
              )}
            </dl>
            {!isGif && effective.mode === 'selective' && (
              <PlanNote state={planState} sources={project.sources} />
            )}
          </section>
        )}

        {state.phase === 'running' && (
          <section className="card">
            <h2>Експорт іде</h2>
            <progress
              className="export-progress"
              max={progress?.total || total || 1}
              value={progress?.time ?? 0}
            />
            <p className="export-status" role="status">
              {progress ? progressText(progress, remaining) : 'Готую кодувальники…'}
            </p>
            <p className="muted export-note">
              Можна повернутися до редактора: експорт працює далі, а хід видно на вкладці внизу.
            </p>
          </section>
        )}

        {state.phase === 'done' && (
          <section className="card">
            <div className="result-head">
              <h2>Результат</h2>
              <div className="result-actions">
                <button type="button" className="btn" onClick={job.reset}>
                  Закрити результат
                </button>
                <a
                  className="btn btn-primary"
                  href={state.url}
                  download={exportFileName(state.result.settings.container)}
                >
                  Зберегти
                </a>
              </div>
            </div>
            {state.result.settings.container === 'gif' ? (
              <img className="export-video" src={state.url} alt="Результат експорту" />
            ) : (
              <video className="export-video" src={state.url} controls />
            )}
            <ResultInfo result={state.result} />
            {state.result.memory && <MemoryReport trace={state.result.memory} />}
          </section>
        )}

        {state.phase === 'error' && (
          <section className="card">
            <h2>Експорт не вдався</h2>
            <p className="error" role="alert">
              Не вдалося експортувати: {state.message}
            </p>
            <div className="result-actions">
              <button type="button" className="btn" onClick={job.reset}>
                Закрити
              </button>
            </div>
          </section>
        )}
      </div>
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
