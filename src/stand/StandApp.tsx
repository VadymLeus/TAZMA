// src/stand/StandApp.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AUDIO_LABELS, CONTAINER_LABELS, VIDEO_LABELS, availableCodecs } from '../export/codecs.ts'
import { defaultWorker, runExportJob } from '../export/runJob.ts'
import { planProject } from '../export/selectiveAnalysis.ts'
import { MEMORY_BUDGETS, availableContainers, defaultSettings, normalizeSettings, withContainer } from '../export/settings.ts'
import type { ContainerChoices } from '../export/settings.ts'
import { isVideoSettings } from '../export/types.ts'
import type { Container, ExportSettings, QualityLevel } from '../export/types.ts'
import { formatBytes, formatSpan } from '../media/format.ts'
import { probeFile } from '../media/probe.ts'
import type { Source } from '../project/types.ts'
import { prepareContinue } from '../resume/continueJob.ts'
import { MIN_CLIP } from '../project/timeline.ts'
import { parseSegmentSeconds } from '../resume/interval.ts'
import { listJobs, removeJob } from '../resume/store.ts'
import PlanNote from '../components/PlanNote.tsx'
import type { PlanState } from '../components/PlanNote.tsx'
import { saveText, fileStem } from './download.ts'
import { runWithCrashes } from './crashRun.ts'
import { readEnvironment } from './environment.ts'
import type { Environment } from './environment.ts'
import { exponentialGaps } from './gaps.ts'
import { planConditions, nothingCopied } from './plans.ts'
import { runBenchInWorker } from './bench/benchClient.ts'
import { benchResult } from './bench/benchResult.ts'
import type { PlanFigures } from './plans.ts'
import { WHOLE, buildProject } from './projects.ts'
import { measureQuality } from './qualityMeasure.ts'
import { RECORD_COLUMNS } from './record.ts'
import type { RunRecord } from './record.ts'
import { runSchedule } from './runner.ts'
import { makeSchedule } from './schedule.ts'
import {
  MAX_CUTS,
  MAX_INTERVAL,
  MIN_INTERVAL,
  SERIES_CHOICES,
  ignoredCounts,
  ignoredIntervals,
  ignoredPercents,
  makeSeries,
  parseCounts,
  parseIntervals,
  parseLimits,
  parsePercents,
} from './series.ts'
import type { SeriesId } from './series.ts'
import StandResults from './StandResults.tsx'
import { toCsv } from './csv.ts'

const QUALITY: Record<QualityLevel, string> = { low: 'Низька', medium: 'Середня', high: 'Висока' }

const wholeNumber = (text: string): number | null => {
  const value = Number(text.trim())
  return text.trim() !== '' && Number.isInteger(value) ? value : null
}

const nonNegative = (text: string): number | null => {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null
}

const positive = (text: string): number | null => {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null
}

const aborted = (error: unknown) => error instanceof Error && error.name === 'AbortError'

interface StandAppProps {
  embedded?: boolean
  // The editor of the same page holds files; the stand warns about it.
  editorLoaded?: boolean
}

export default function StandApp({ embedded = false, editorLoaded = false }: StandAppProps) {
  const [source, setSource] = useState<Source | null>(null)
  const [fileError, setFileError] = useState('')
  const [choices, setChoices] = useState<ContainerChoices | null>(null)
  const [base, setBase] = useState<ExportSettings>({ ...defaultSettings, mode: 'full', recordMemory: true, ignoreColor: true })
  const [seriesId, setSeriesId] = useState<SeriesId>('journal')
  const [seconds, setSeconds] = useState('60')
  const [repeats, setRepeats] = useState('5')
  const [warmup, setWarmup] = useState('1')
  const [coolDown, setCoolDown] = useState('2')
  const [seed, setSeed] = useState('1')
  const [limitsText, setLimitsText] = useState('1, 2, 4, 8, 16')
  const [segment, setSegment] = useState('30')
  const [intervalsText, setIntervalsText] = useState('0.5, 1, 2, 4, 8, 16')
  const [mtbf, setMtbf] = useState('8')
  const [sharesText, setSharesText] = useState('0, 10, 25, 50, 75, 100')
  const [countsText, setCountsText] = useState('0, 1, 3, 7, 15')
  const [cutsFixed, setCutsFixed] = useState('0')
  const [shareFixed, setShareFixed] = useState('25')
  const [kind, setKind] = useState<'text' | 'effect'>('text')
  const [qualityFrames, setQualityFrames] = useState('8')
  const [running, setRunning] = useState(false)
  const [records, setRecords] = useState<RunRecord[]>([])
  const [shownSeries, setShownSeries] = useState<ReturnType<typeof makeSeries> | null>(null)
  const [status, setStatus] = useState('')
  const [overall, setOverall] = useState({ done: 0, total: 0 })
  const [current, setCurrent] = useState(0)
  const [environment, setEnvironment] = useState<Environment | null>(null)
  const [planState, setPlanState] = useState<PlanState>({ phase: 'idle' })
  const [refused, setRefused] = useState(false)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    document.title = 'TAZMA · стенд замірів'
  }, [])

  const info = source?.info ?? null
  const size = info?.video ? { width: info.video.width, height: info.video.height } : null
  useEffect(() => {
    if (!size) return
    let live = true
    void Promise.all([availableCodecs('mp4', size), availableCodecs('webm', size)]).then(([mp4, webm]) => {
      if (live) setChoices({ mp4, webm })
    })
    return () => {
      live = false
    }
  }, [size?.width, size?.height])

  const settings = choices ? normalizeSettings(base, choices, []) : base
  const containers = choices ? availableContainers(choices).filter((container) => container !== 'gif') : []
  const codecs = settings.container !== 'gif' ? choices?.[settings.container] : undefined

  const copies = seriesId === 'journal' || seriesId === 'share' || seriesId === 'cuts' || seriesId === 'components'
  const { container, videoCodec, quality, height, ignoreColor } = settings
  const previewSeconds = nonNegative(seconds)
  useEffect(() => {
    const planSettings = { ...settings, mode: 'selective' as const }
    if (!source || !choices || !copies || previewSeconds === null || !isVideoSettings(planSettings)) {
      setPlanState({ phase: 'idle' })
      return
    }
    const control = new AbortController()
    setPlanState({ phase: 'loading' })
    const timer = setTimeout(() => {
      planProject(buildProject(source, { ...WHOLE, seconds: previewSeconds }), planSettings, control.signal).then(
        (plan) => setPlanState({ phase: 'ready', plan }),
        (error: unknown) => {
          if (control.signal.aborted) return
          setPlanState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
        },
      )
    }, 150)
    return () => {
      clearTimeout(timer)
      control.abort()
    }
  }, [source, choices, copies, container, videoCodec, quality, height, ignoreColor, previewSeconds])

  const repeatsN = wholeNumber(repeats)
  const warmupN = wholeNumber(warmup)
  const coolDownN = nonNegative(coolDown)
  const secondsN = nonNegative(seconds)
  const seedN = wholeNumber(seed)
  const segmentN = parseSegmentSeconds(segment)
  const limits = parseLimits(limitsText)
  const intervals = parseIntervals(intervalsText)
  const ignored = ignoredIntervals(intervalsText)
  const mtbfN = positive(mtbf)
  const shares = parsePercents(sharesText)
  const counts = parseCounts(countsText)
  const cutsFixedN = wholeNumber(cutsFixed)
  const shareFixedN = nonNegative(shareFixed)
  const qualityN = wholeNumber(qualityFrames)
  const mostCuts = seriesId === 'cuts' ? Math.max(0, ...counts) : seriesId === 'share' ? (cutsFixedN ?? 0) : 0
  const length = info ? (secondsN && secondsN > 0 ? Math.min(secondsN, info.duration) : info.duration) : 0
  const problem =
    !source ? 'Оберіть файл.'
    : !info?.video ? 'У файлі немає відео.'
    : repeatsN === null || repeatsN < 1 ? 'Повторів має бути ціле число, не менше 1.'
    : warmupN === null || warmupN < 0 ? 'Прогріву має бути ціле число, не менше 0.'
    : coolDownN === null ? 'Пауза між прогонами — число секунд, не менше 0.'
    : secondsN === null ? 'Фрагмент — число секунд (0 — весь файл).'
    : seedN === null ? 'Зерно — ціле число.'
    : seriesId === 'journal' && segmentN === null ? 'Довжина частини — від 2 до 600 с.'
    : seriesId === 'flow' && limits.length === 0 ? 'Вкажіть хоча б один ліміт N.'
    : seriesId === 'interval' && ignored.length > 0 ? `Не підходить: ${ignored.join(', ')}. Довжина частини — від ${MIN_INTERVAL} до ${MAX_INTERVAL} с.`
    : seriesId === 'interval' && intervals.length === 0 ? 'Вкажіть хоча б одну довжину частини.'
    : seriesId === 'interval' && mtbfN === null ? 'Проміжок між обривами — додатне число секунд.'
    : (seriesId === 'interval' || seriesId === 'components') && settings.container === 'gif' ? 'Для цієї серії потрібне відео.'
    : seriesId === 'share' && ignoredPercents(sharesText).length > 0 ? `Не підходить: ${ignoredPercents(sharesText).join(', ')}. Частка — від 0 до 100 %.`
    : seriesId === 'share' && shares.length === 0 ? 'Вкажіть хоча б одну частку.'
    : seriesId === 'share' && (cutsFixedN === null || cutsFixedN < 0 || cutsFixedN > MAX_CUTS) ? `Розрізів — ціле число від 0 до ${MAX_CUTS}.`
    : seriesId === 'cuts' && ignoredCounts(countsText).length > 0 ? `Не підходить: ${ignoredCounts(countsText).join(', ')}. Розрізів — цілі числа від 0 до ${MAX_CUTS}.`
    : seriesId === 'cuts' && counts.length === 0 ? 'Вкажіть хоча б одне число розрізів.'
    : seriesId === 'cuts' && (shareFixedN === null || shareFixedN > 100) ? 'Частка — від 0 до 100 %.'
    : (seriesId === 'share' || seriesId === 'cuts') && (qualityN === null || qualityN < 0) ? 'Кадрів для порівняння — ціле число, не менше 0.'
    : (seriesId === 'share' || seriesId === 'cuts') && length < (mostCuts + 3) * MIN_CLIP * 2 ? 'Фрагмент закороткий для такого числа розрізів.'
    : !choices ? 'Перевіряю кодеки…'
    : containers.length === 0 ? 'Браузер не вміє кодувати відео.'
    : ''

  const series = useMemo(
    () =>
      makeSeries(seriesId, {
        seconds: secondsN ?? 0,
        limits,
        segmentSeconds: segmentN ?? 30,
        intervals,
        mtbfSeconds: mtbfN ?? 8,
        shares,
        cutCounts: counts,
        cuts: cutsFixedN ?? 0,
        share: (shareFixedN ?? 0) / 100,
        kind,
      }),
    [seriesId, secondsN, limitsText, segmentN, intervalsText, mtbfN, sharesText, countsText, cutsFixedN, shareFixedN, kind],
  )
  const total = problem === '' ? series.conditions.length * (repeatsN ?? 0) + (warmupN ?? 0) : 0

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileError('')
    try {
      const probed = await probeFile(file)
      setSource({ id: 's0', file, url: '', info: probed })
      setChoices(null)
    } catch (error) {
      setSource(null)
      setFileError(error instanceof Error ? error.message : String(error))
    }
  }

  async function start() {
    if (!source || problem !== '' || repeatsN === null || warmupN === null || coolDownN === null || seedN === null) return
    const control = new AbortController()
    controller.current = control
    setRunning(true)
    setRefused(false)
    setRecords([])
    setShownSeries(series)
    setEnvironment(readEnvironment())
    const schedule = makeSchedule({
      conditions: series.conditions.map((condition) => condition.id),
      repeats: repeatsN,
      seed: seedN,
      warmupRuns: warmupN,
    })
    setOverall({ done: 0, total: schedule.length })
    setStatus('Починаю…')
    try {
      let figures = new Map<string, PlanFigures>()
      if (series.conditions.some((condition) => ({ ...settings, ...condition.settings }).mode === 'selective')) {
        setStatus('Складаю план вибіркового експорту…')
        figures = await planConditions(series, source, settings, planProject, control.signal)
        const nothing = seriesId === 'share' || seriesId === 'cuts' ? nothingCopied(figures) : null
        if (nothing) {
          setStatus(`${nothing} Серію не запущено: змініть налаштування (наприклад, увімкніть «Не звіряти колірний простір»).`)
          setRefused(true)
          return
        }
      }
      await runSchedule({
        series,
        schedule,
        coolDownMs: coolDownN * 1000,
        signal: control.signal,
        execute: (condition, run) => {
          setCurrent(0)
          const project = buildProject(source, condition.spec)
          const options = {
            signal: control.signal,
            onProgress: (progress: { time: number; total: number }) =>
              setCurrent(progress.total > 0 ? progress.time / progress.total : 0),
          }
          const runSettings = { ...settings, recordMemory: true, ...condition.settings }
          if (condition.bench) {
            const kind = condition.bench
            const spec = { kind, file: source.file, seconds: condition.spec.seconds ?? 0, videoCodec: settings.videoCodec, quality: settings.quality }
            return runBenchInWorker(spec, control.signal).then((output) => benchResult(kind, output, runSettings))
          }
          if (condition.crashMeanMs === undefined) {
            return runExportJob(project, runSettings, options).then(async (result) => {
              if (!series.quality || !qualityN || !info?.video) return result
              const quality = await measureQuality(
                project,
                result.blob,
                { width: result.width, height: result.height, frameRate: info.video.frameRate },
                qualityN,
                control.signal,
              ).catch(() => null)
              return { ...result, quality }
            })
          }
          return runWithCrashes(
            project,
            runSettings,
            { gap: exponentialGaps(seedN, run.round + 1, condition.crashMeanMs) },
            {
              run: (p, s, o, create) => runExportJob(p, s, o, { createWorker: create }),
              base: defaultWorker,
              listJobs,
              prepare: (job, current) => prepareContinue(job, [source.file], current, { probe: probeFile }),
              removeJob,
            },
            options,
          ).then(({ result, figures }) => ({ ...result, crash: figures }))
        },
        onStart: (run, condition, done, count) =>
          setStatus(`Прогін ${done + 1} з ${count}: ${condition.label}${run.warmup ? ' (прогрів)' : `, коло ${run.round + 1}`}`),
        onRecord: (record, done, count) => {
          const planned = figures.get(record.condition)
          setRecords((list) => [
            ...list,
            planned ? { ...record, plannedShare: planned.plannedShare, blockers: planned.blockers } : record,
          ])
          setOverall({ done, total: count })
        },
      })
      setStatus(control.signal.aborted ? 'Зупинено: у таблиці те, що встигло виконатися.' : 'Серію виконано.')
    } catch (error) {
      setStatus(aborted(error) ? 'Зупинено.' : `Серія перервалась: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRunning(false)
      setCurrent(0)
      controller.current = null
    }
  }

  function saveCsv() {
    if (!shownSeries) return
    saveText(`${fileStem(shownSeries.id)}.csv`, toCsv(records as unknown as Record<string, unknown>[], RECORD_COLUMNS), 'text/csv')
  }

  function saveJson() {
    if (!shownSeries || !source) return
    const video = source.info.video
    const body = {
      environment,
      series: { id: shownSeries.id, title: shownSeries.title, conditions: shownSeries.conditions },
      file: {
        name: source.info.fileName,
        bytes: source.info.fileSize,
        duration: source.info.duration,
        video: video && { codec: video.codec, width: video.width, height: video.height, frameRate: video.frameRate },
      },
      options: {
        seconds: secondsN, repeats: repeatsN, warmupRuns: warmupN, coolDownSeconds: coolDownN, seed: seedN, limits, segmentSeconds: segmentN,
        intervals, mtbfSeconds: mtbfN, shares, cutCounts: counts, cuts: cutsFixedN, share: shareFixedN, kind, qualityFrames: qualityN,
      },
      settings,
      records,
    }
    saveText(`${fileStem(shownSeries.id)}.json`, JSON.stringify(body, null, 2), 'application/json')
  }

  return (
    <div className={embedded ? 'stand stand-page' : 'app stand'}>
      {!embedded && (
        <header className="app-header">
          <span className="brand">TAZMA</span>
          <span className="stage">Стенд замірів</span>
          <div className="header-actions">
            <a className="btn" href={window.location.pathname}>
              До редактора
            </a>
          </div>
        </header>
      )}

      <section className="card stand-side">
        {editorLoaded && (
          <p className="notice stand-warn">
            У редакторі відкрито файли. Вони лишаються в пам’яті сторінки (відео, ключові кадри) і можуть змінити цифри,
            особливо пам’яті. Для чистих замірів відкрийте стенд у свіжій вкладці за адресою /?stand, без файлів у редакторі.
          </p>
        )}
        <div className="group">
          <h3>Файл</h3>
          <label className="field">
            <span>Відеофайл для замірів</span>
            <input
              type="file"
              accept="video/*,.mkv,.webm,.mp4,.m4v,.mov"
              disabled={running}
              onChange={(event: ChangeEvent<HTMLInputElement>) => void pick(event)}
            />
          </label>
          {fileError && <p className="error">{fileError}</p>}
          {info?.video && (
            <p className="muted export-note">
              {info.fileName} · {formatSpan(info.duration)} · {info.video.width}×{info.video.height} · {info.video.codec} ·{' '}
              {Math.round(info.video.frameRate * 100) / 100} к/с · {formatBytes(info.fileSize)}
            </p>
          )}
        </div>
        {choices && (
          <>
            <div className="group">
              <h3>Запис</h3>
              <div className="field-row">
                <label className="field">
                  <span>Формат</span>
                  <select
                    value={settings.container}
                    disabled={running}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setBase(withContainer(settings, event.target.value as Container))
                    }
                  >
                    {containers.map((container) => (
                      <option key={container} value={container}>
                        {CONTAINER_LABELS[container]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Відеокодек</span>
                  <select
                    value={settings.videoCodec}
                    disabled={running}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setBase({ ...settings, videoCodec: event.target.value as ExportSettings['videoCodec'] })
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
                    value={settings.audioCodec}
                    disabled={running || !codecs || codecs.audio.length === 0}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setBase({ ...settings, audioCodec: event.target.value as ExportSettings['audioCodec'] })
                    }
                  >
                    {codecs?.audio.map((codec) => (
                      <option key={codec} value={codec}>
                        {AUDIO_LABELS[codec] ?? codec}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Якість</span>
                  <select
                    value={settings.quality}
                    disabled={running}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setBase({ ...settings, quality: event.target.value as QualityLevel })
                    }
                  >
                    {(Object.keys(QUALITY) as QualityLevel[]).map((level) => (
                      <option key={level} value={level}>
                        {QUALITY[level]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="group">
              <h3>Пам’ять і потік</h3>
              <div className="field-row">
                <label className="field">
                  <span>Бюджет пам’яті на кадри (режим «Авто»)</span>
                  <select
                    value={settings.memoryBudget}
                    disabled={running}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => setBase({ ...settings, memoryBudget: Number(event.target.value) })}
                  >
                    {MEMORY_BUDGETS.map((budget) => (
                      <option key={budget} value={budget}>
                        {budget} МБ
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.inWorker !== false}
                  disabled={running}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setBase({ ...settings, inWorker: event.target.checked })}
                />
                <span>Виконувати в окремому потоці (без нього видно купу JS на сторінці)</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.ignoreColor}
                  disabled={running}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setBase({ ...settings, ignoreColor: event.target.checked })}
                />
                <span>Не звіряти колірний простір (вибірковий експорт)</span>
              </label>
              <p className="muted export-note">
                Кодувальник Chromium позначає кадри з полотна як BT.601, тож файли BT.709 (зазвичай HD) за звіркою не копіюються
                зовсім. З галочкою копіювання працює, але колір скопійованих ділянок може відрізнятися від перерахованих, і
                PSNR та SSIM у серіях частки й розрізів на таких файлах будуть занижені.
              </p>
            </div>
          </>
        )}
      </section>

      <div className="stand-main">
        <section className="card stand-runbar">
          <div className="stand-runrow">
            <div className="stand-runtext">
              {problem !== '' ? <span className="muted">{problem}</span> : <span className="muted">Прогонів: {total}</span>}
              {status !== '' && (
                <p className={refused ? 'error export-status' : 'export-status'} role="status">
                  {status}
                </p>
              )}
            </div>
            {running ? (
              <button type="button" className="btn" onClick={() => controller.current?.abort()}>
                Зупинити
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={problem !== ''} onClick={() => void start()}>
                Запустити серію
              </button>
            )}
          </div>
          {(running || records.length > 0) && !refused && (
            <progress
              className="export-progress"
              max={Math.max(overall.total, 1)}
              value={overall.done + (running ? current : 0)}
            />
          )}
        </section>

        <section className="card">
          <h2>Серія</h2>
          <div className="stand-series">
            {SERIES_CHOICES.map((choice) => (
              <label key={choice.id} className="check">
                <input
                  type="radio"
                  name="series"
                  checked={seriesId === choice.id}
                  disabled={running}
                  onChange={() => setSeriesId(choice.id)}
                />
                <span>{choice.title}</span>
              </label>
            ))}
          </div>
          <p className="muted export-note">{series.note}</p>
          <div className="field-row">
            <label className="field">
              <span>Фрагмент, с (0 — весь файл)</span>
              <input type="number" min="0" step="any" value={seconds} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setSeconds(e.target.value)} />
            </label>
            <label className="field">
              <span>Повторів</span>
              <input type="number" min="1" step="1" value={repeats} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setRepeats(e.target.value)} />
            </label>
            <label className="field">
              <span>Прогрівальних прогонів</span>
              <input type="number" min="0" step="1" value={warmup} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setWarmup(e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Пауза між прогонами, с</span>
              <input type="number" min="0" step="any" value={coolDown} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setCoolDown(e.target.value)} />
            </label>
            <label className="field">
              <span>Зерно порядку</span>
              <input type="number" step="1" value={seed} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setSeed(e.target.value)} />
            </label>
            {seriesId === 'flow' && (
              <label className="field">
                <span>Ліміти N</span>
                <input type="text" value={limitsText} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setLimitsText(e.target.value)} />
              </label>
            )}
            {seriesId === 'interval' && (
              <>
                <label className="field">
                  <span>Довжини частини, с</span>
                  <input type="text" value={intervalsText} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setIntervalsText(e.target.value)} />
                </label>
                <label className="field">
                  <span>Середній проміжок між обривами M, с</span>
                  <input type="number" min="0" step="any" value={mtbf} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setMtbf(e.target.value)} />
                </label>
              </>
            )}
            {seriesId === 'share' && (
              <>
                <label className="field">
                  <span>Частки ефекту, %</span>
                  <input type="text" value={sharesText} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setSharesText(e.target.value)} />
                </label>
                <label className="field">
                  <span>Розрізів у проєкті</span>
                  <input type="number" min="0" max={MAX_CUTS} step="1" value={cutsFixed} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setCutsFixed(e.target.value)} />
                </label>
              </>
            )}
            {seriesId === 'cuts' && (
              <>
                <label className="field">
                  <span>Числа розрізів</span>
                  <input type="text" value={countsText} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setCountsText(e.target.value)} />
                </label>
                <label className="field">
                  <span>Частка ефекту, %</span>
                  <input type="number" min="0" max="100" step="any" value={shareFixed} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setShareFixed(e.target.value)} />
                </label>
              </>
            )}
            {(seriesId === 'share' || seriesId === 'cuts') && (
              <>
                <label className="field">
                  <span>Що покриває частку</span>
                  <select value={kind} disabled={running} onChange={(e: ChangeEvent<HTMLSelectElement>) => setKind(e.target.value as 'text' | 'effect')}>
                    <option value="text">Напис</option>
                    <option value="effect">Фільтр (чорно-біле)</option>
                  </select>
                </label>
                <label className="field">
                  <span>Кадрів для порівняння якості (0 — без)</span>
                  <input type="number" min="0" step="1" value={qualityFrames} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setQualityFrames(e.target.value)} />
                </label>
              </>
            )}
            {seriesId === 'journal' && (
              <label className="field">
                <span>Довжина частини, с</span>
                <input type="number" min="2" max="600" step="any" value={segment} disabled={running} onChange={(e: ChangeEvent<HTMLInputElement>) => setSegment(e.target.value)} />
              </label>
            )}
          </div>
          {(seriesId === 'share' || seriesId === 'cuts' || seriesId === 'components') && info?.video && info.video.codec !== settings.videoCodec && (
            <p className="error export-note">
              Відео у файлі — {info.video.codec}, а для запису вибрано {settings.videoCodec}: вибірковий експорт копіює пакети лише коли
              кодеки збігаються, тож нічого не скопіює. Оберіть відеокодек файлу.
            </p>
          )}
          {copies && planState.phase !== 'idle' && (
            <>
              <p className="muted export-note">План вибіркового експорту для всього фрагмента, без написів і розрізів:</p>
              <PlanNote state={planState} sources={source ? [source] : []} />
              {(seriesId === 'share' || seriesId === 'cuts') &&
                planState.phase === 'ready' &&
                planState.plan.summary.copySeconds < 0.01 && (
                  <p className="error export-note">
                    За планом нічого не копіюється, серія з такими налаштуваннями покаже лише повне перекодування. Усуньте причину
                    вище або увімкніть «Не звіряти колірний простір».
                  </p>
                )}
            </>
          )}
          <p className="muted export-note">
            Умови йдуть по черзі, порядок у кожному колі випадковий (за зерном). Для чесних цифр закрийте інші вкладки й
            програми, не вимикайте ноутбук із мережі й не чіпайте сторінку під час серії.
          </p>
        </section>

        {shownSeries && records.length > 0 && (
          <section className="card">
            <h2>Результати: {shownSeries.title}</h2>
            <StandResults series={shownSeries} records={records} />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={saveCsv}>
                Зберегти CSV
              </button>
              <button type="button" className="btn" onClick={saveJson}>
                Зберегти JSON
              </button>
            </div>
            <details className="stand-runs">
              <summary>Усі прогони ({records.length})</summary>
              <ul>
                {records.map((record) => (
                  <li key={record.index} className={record.ok ? undefined : 'error'}>
                    {record.index + 1}. {record.label} · {record.warmup ? 'прогрів' : `коло ${record.round + 1}`} ·{' '}
                    {record.ok && record.elapsedMs !== null ? `${(record.elapsedMs / 1000).toFixed(1).replace('.', ',')} с` : record.error}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </div>
    </div>
  )
}
