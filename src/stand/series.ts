// src/stand/series.ts
import type { ExportSettings } from '../export/types.ts'
import type { MetricKey } from './aggregate.ts'
import type { BenchKind } from './bench/protocol.ts'
import { WHOLE } from './projects.ts'
import type { ProjectSpec } from './projects.ts'

// One way of running the same export: what is changed in the settings and
// what the project is like.
export interface Condition {
  id: string
  label: string
  settings: Partial<ExportSettings>
  spec: ProjectSpec
  // Length of a part of the journal, in timeline seconds, when the condition
  // is one of a sweep of those.
  interval?: number
  // Mean time between the cuts the run is put through, in milliseconds; a run
  // without it is not cut.
  crashMeanMs?: number
  // Times one part of the pipeline alone instead of running an export.
  bench?: BenchKind
}

// Two conditions whose ratio is of interest (the first over the second).
export interface Pair {
  numerator: string
  denominator: string
  label: string
  // The figures whose ratio is shown; the time of the export when missing.
  keys?: MetricKey[]
}

export interface Series {
  id: string
  title: string
  // What it measures, in a sentence for the person.
  note: string
  conditions: Condition[]
  metrics: MetricKey[]
  pairs: Pair[]
  // The frames of the files are compared with what the project asks for.
  quality?: boolean
}

export interface SeriesOptions {
  // Seconds of the file every run exports; 0 takes all of it.
  seconds: number
  // The limits N tried by the series of the frame limit.
  limits: number[]
  // Length of a part of the journal, in timeline seconds.
  segmentSeconds: number
  // The part lengths swept by the series of the checkpoint interval, and the
  // mean time between cuts there, in seconds.
  intervals: number[]
  mtbfSeconds: number
  // The series of the share of effects and of the cuts: the shares tried
  // (fractions), the numbers of cuts tried, the cuts and the share held fixed
  // in the other series, and what covers the share.
  shares: number[]
  cutCounts: number[]
  cuts: number
  share: number
  kind: 'text' | 'effect'
}

export const MIN_INTERVAL = 0.25
export const MAX_INTERVAL = 600

const tokensOf = (text: string): string[] =>
  text
    .split(/[\s;]+/)
    .map((part) => part.replace(/,+$/, ''))
    .filter(Boolean)

const valueOf = (token: string): number => Number(token.replace(',', '.'))

const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max

// Numbers typed by the person: separated by spaces or semicolons (a comma
// before a space ends a number too); a decimal mark is a point or a comma.
// Those within the limits come out once each, rising.
export function parseNumbers(text: string, min: number, max: number): number[] {
  return [...new Set(tokensOf(text).map(valueOf).filter((value) => within(value, min, max)))].sort((a, b) => a - b)
}

// What was typed but is not a number within the limits.
export function ignoredNumbers(text: string, min: number, max: number): string[] {
  return tokensOf(text).filter((token) => !within(valueOf(token), min, max))
}

// The part lengths as a clean list: numbers within the limits, each once,
// rising.
export function cleanIntervals(values: number[]): number[] {
  return [...new Set(values.filter((value) => within(value, MIN_INTERVAL, MAX_INTERVAL)))].sort((a, b) => a - b)
}

export const parseIntervals = (text: string): number[] => parseNumbers(text, MIN_INTERVAL, MAX_INTERVAL)
export const ignoredIntervals = (text: string): string[] => ignoredNumbers(text, MIN_INTERVAL, MAX_INTERVAL)

// Shares of the timeline typed in percent, as fractions.
export const parsePercents = (text: string): number[] => parseNumbers(text, 0, 100).map((value) => value / 100)
export const ignoredPercents = (text: string): string[] => ignoredNumbers(text, 0, 100)

export const MAX_CUTS = 100

// Numbers of cuts: whole numbers from 0.
export const parseCounts = (text: string): number[] => parseNumbers(text, 0, MAX_CUTS).filter(Number.isInteger)
export const ignoredCounts = (text: string): string[] =>
  tokensOf(text).filter((token) => !(within(valueOf(token), 0, MAX_CUTS) && Number.isInteger(valueOf(token))))

// The limits typed by the person: numbers separated by commas, semicolons or
// spaces; whatever is not a whole number of at least 1 is dropped.
export function parseLimits(text: string): number[] {
  return cleanLimits(text.split(/[\s,;]+/).filter(Boolean).map(Number))
}

// The limits as a clean list: whole numbers of at least 1, each once, rising.
export function cleanLimits(limits: number[]): number[] {
  return [...new Set(limits.filter((value) => Number.isInteger(value) && value >= 1))].sort((a, b) => a - b)
}

// Cost of the journal: the same export with and without it, in both modes.
// The runs of the four conditions go one after another in turn, so the ratio of
// each pair is read off runs that were close in time.
export function journalCostSeries(options: SeriesOptions): Series {
  const spec: ProjectSpec = { ...WHOLE, seconds: options.seconds, share: 0.25, kind: 'text' }
  const journal = { resumable: true, segmentSeconds: options.segmentSeconds }
  const plain = { resumable: false }
  return {
    id: 'journal',
    title: 'Ціна журналу',
    note: 'Той самий експорт без журналу й з ним, у повному й вибірковому режимах (у вибірковому чверть таймлайну під написом). Умови йдуть по черзі, відношення береться по парах з одного кола.',
    conditions: [
      { id: 'full-plain', label: 'Повний, без журналу', settings: { mode: 'full', ...plain }, spec },
      { id: 'full-journal', label: 'Повний, з журналом', settings: { mode: 'full', ...journal }, spec },
      { id: 'selective-plain', label: 'Вибірковий, без журналу', settings: { mode: 'selective', ...plain }, spec },
      { id: 'selective-journal', label: 'Вибірковий, з журналом', settings: { mode: 'selective', ...journal }, spec },
    ],
    metrics: ['elapsedMs', 'fps', 'bytes', 'checkpointMs', 'journalMiB', 'waitMs', 'composeMs', 'encodeMs', 'firstFrameMs', 'setupMs', 'firstItemMs', 'firstAddMs', 'borrowed', 'gateMs'],
    pairs: [
      { numerator: 'full-journal', denominator: 'full-plain', label: 'Повний: з журналом / без' },
      { numerator: 'selective-journal', denominator: 'selective-plain', label: 'Вибірковий: з журналом / без' },
    ],
  }
}

// The frame limit: what the library does by itself, fixed limits N, and the
// automatic choice, in the full mode where every frame goes through the
// decoder and the encoder.
export function flowSeries(options: SeriesOptions): Series {
  const spec: ProjectSpec = { ...WHOLE, seconds: options.seconds }
  const base = { mode: 'full' as const, resumable: false }
  const limits = cleanLimits(options.limits)
  const conditions: Condition[] = [
    { id: 'library', label: 'Бібліотека (без свого ліміту)', settings: { ...base, flow: 'library' }, spec },
    ...limits.map((limit) => ({
      id: `fixed-${limit}`,
      label: `N = ${limit}`,
      settings: { ...base, flow: 'fixed' as const, flowLimit: limit },
      spec,
    })),
    { id: 'auto', label: 'Авто', settings: { ...base, flow: 'auto' }, spec },
  ]
  return {
    id: 'flow',
    title: 'Ліміт кадрів N',
    note: 'Час і пам’ять кадрів у повному режимі: без власного ліміту (черги бібліотеки), з фіксованими N і з автоматичним вибором.',
    conditions,
    metrics: ['elapsedMs', 'fps', 'limit', 'memLimit', 'w0Ms', 'w0FirstMs', 'lambdaFps', 'probeFps', 'peakFrames', 'peakFrameMiB', 'peakHeapMiB', 'firstFrameMs', 'borrowed', 'waitMs', 'composeMs', 'encodeMs'],
    pairs: conditions
      .filter((condition) => condition.id !== 'library')
      .map((condition) => ({
        numerator: condition.id,
        denominator: 'library',
        label: `${condition.label} / бібліотека`,
        keys: ['elapsedMs', 'peakFrameMiB'] as MetricKey[],
      })),
  }
}

// The checkpoint interval against cuts: the same export put through cuts at
// random moments (exponential gaps, the same ones for every condition of a
// round), once per part length, and the plain export without a journal or cuts
// to measure the waste against. The figures are read against the formula.
export function intervalSeries(options: SeriesOptions): Series {
  const spec: ProjectSpec = { ...WHOLE, seconds: options.seconds }
  const base = { mode: 'full' as const, inWorker: true }
  const intervals = cleanIntervals(options.intervals)
  const label = (interval: number) => `Частина ${String(interval).replace('.', ',')} с`
  const conditions: Condition[] = [
    { id: 'ref', label: 'Без журналу й без обривів', settings: { ...base, resumable: false }, spec },
    ...intervals.map((interval) => ({
      id: `nc-${interval}`,
      label: `${label(interval)}, без обривів`,
      settings: { ...base, resumable: true, segmentSeconds: interval },
      spec,
      interval,
    })),
    ...intervals.map((interval) => ({
      id: `tau-${interval}`,
      label: `${label(interval)}, з обривами`,
      settings: { ...base, resumable: true, segmentSeconds: interval },
      spec,
      interval,
      crashMeanMs: options.mtbfSeconds * 1000,
    })),
  ]
  return {
    id: 'interval',
    title: 'Інтервал контрольних точок',
    note: 'Повний експорт із журналом для кількох довжин частини: без обривів (ціна точок) і з обривами в випадкові моменти (проміжки показникові, однакові для всіх умов кола), які продовжуються з журналу. Порівняння з формулою τ = √(2·t_c·M).',
    conditions,
    metrics: ['wallMs', 'crashes', 'freshStarts', 'restartMs', 'checkpointMs', 'openMs', 'commits'],
    pairs: [],
  }
}

const percentText = (fraction: number) => `${String(Math.round(fraction * 1000) / 10).replace('.', ',')} %`

function cutsWord(count: number): string {
  if (count === 0) return 'без розрізів'
  const last = count % 10
  const word = count % 100 >= 11 && count % 100 <= 14 ? 'розрізів' : last === 1 ? 'розріз' : last >= 2 && last <= 4 ? 'розрізи' : 'розрізів'
  return `${count} ${word}`
}

// The modes side by side over a list of projects: the full re-encode and the
// selective one on each. Every project is run in both modes, so the ratio of
// the pair is a difference of the mode only.
function modesSeries(
  id: string,
  title: string,
  note: string,
  cases: { key: string; label: string; spec: ProjectSpec }[],
): Series {
  const full = { mode: 'full' as const, resumable: false }
  const selective = { mode: 'selective' as const, resumable: false }
  const conditions: Condition[] = cases.flatMap((item) => [
    { id: `full-${item.key}`, label: `Повний, ${item.label}`, settings: full, spec: item.spec },
    { id: `sel-${item.key}`, label: `Вибірковий, ${item.label}`, settings: selective, spec: item.spec },
  ])
  return {
    id,
    title,
    note,
    conditions,
    metrics: [
      'elapsedMs', 'fps', 'plannedShare', 'copiedShare', 'bytes', 'psnrMean', 'ssimMean', 'identicalShare', 'setupMs',
      'firstItemMs', 'firstAddMs', 'firstFrameMs', 'decodeAskMs', 'firstSampleMs',
    ],
    pairs: cases.map((item) => ({
      numerator: `sel-${item.key}`,
      denominator: `full-${item.key}`,
      label: `${item.label}: вибірковий / повний`,
      keys: ['elapsedMs', 'bytes'] as MetricKey[],
    })),
    quality: true,
  }
}

// How much of the timeline needs the effect: the selective export against the
// full one for projects whose effect covers a growing stretch.
export function shareSeries(options: SeriesOptions): Series {
  const cases = cleanShares(options.shares).map((share) => ({
    key: String(share),
    label: percentText(share),
    spec: { ...WHOLE, seconds: options.seconds, cuts: options.cuts, share, kind: options.kind } as ProjectSpec,
  }))
  return modesSeries(
    'share',
    'Частка ефектів',
    'Вибірковий і повний експорт для проєктів, де ефект (напис або фільтр) займає зростаючу частку таймлайну. Показано час, скільки скопійовано без перекодування, розмір і похибку кадрів проти того, що просить проєкт.',
    cases,
  )
}

// How many cuts there are: each one that falls inside a group of frames makes
// the planner encode the edges of the pieces again.
export function cutsSeries(options: SeriesOptions): Series {
  const cases = cleanCounts(options.cutCounts).map((cuts) => ({
    key: String(cuts),
    label: cutsWord(cuts),
    spec: { ...WHOLE, seconds: options.seconds, cuts, share: options.share, kind: options.kind } as ProjectSpec,
  }))
  return modesSeries(
    'cuts',
    'Розрізи',
    `Вибірковий і повний експорт для проєктів із зростаючим числом розрізів, коли ефект займає ${percentText(options.share)} таймлайну. Розріз усередині групи кадрів змушує перекодувати краї шматків.`,
    cases,
  )
}

// Where the time of the pipeline goes: its parts timed one by one on the same
// file (reading packets, decoding, copying packets into an output that is
// thrown away and into a file, encoding frames, starting an encoder session
// alone and while the decoder works), beside the full and the selective export
// of the same stretch. Everything runs in turn, so the parts are read against
// the exports of the same round.
export function componentsSeries(options: SeriesOptions): Series {
  const spec: ProjectSpec = { ...WHOLE, seconds: options.seconds }
  const text: ProjectSpec = { ...spec, share: 0.25, kind: 'text' }
  const plain = { resumable: false }
  const bench = (kind: BenchKind, label: string): Condition => ({
    id: kind,
    label,
    settings: {},
    spec,
    bench: kind,
  })
  return {
    id: 'components',
    title: 'Складові конвеєра',
    note: 'Частини конвеєра, виміряні окремо на одному файлі: читання пакетів без декодування, декодування, копіювання пакетів у «порожній» вихід і у файл, кодування кадрів, старт сеансу кодувальника (сам і поки працює декодер). Поряд — повний і вибірковий експорт того ж фрагмента, щоб бачити, скільки з їхнього часу припадає на кожну частину.',
    conditions: [
      bench('read', 'Читання пакетів'),
      bench('decode', 'Декодування'),
      bench('copy-null', 'Копіювання в порожній вихід'),
      bench('copy-file', 'Копіювання у файл'),
      bench('encode', 'Кодування кадрів'),
      bench('session', 'Старт сеансу кодувальника'),
      bench('session-busy', 'Старт сеансу, декодер працює'),
      { id: 'ref-full', label: 'Повний експорт', settings: { mode: 'full', ...plain }, spec },
      { id: 'ref-sel', label: 'Вибірковий експорт', settings: { mode: 'selective', ...plain }, spec: text },
      { id: 'ref-full-lib', label: 'Повний, без воріт кадрів', settings: { mode: 'full', ...plain, flow: 'library' }, spec },
      { id: 'ref-sel-lib', label: 'Вибірковий, без воріт кадрів', settings: { mode: 'selective', ...plain, flow: 'library' }, spec: text },
    ],
    metrics: [
      'elapsedMs', 'fps', 'bytes', 'setupMs', 'firstItemMs', 'firstAddMs', 'firstFrameMs', 'startRunMs', 'readMs',
      'decodeMs', 'sendMs', 'composeMs', 'encodeMs', 'endRunMs', 'finishMs', 'probeMs', 'scanMs', 'decodeAskMs', 'firstSampleMs',
      'borrowed', 'floor', 'gateMs',
    ],
    pairs: [
      { numerator: 'copy-null', denominator: 'read', label: 'Копіювання в порожній вихід / лише читання', keys: ['elapsedMs'] },
      { numerator: 'copy-file', denominator: 'copy-null', label: 'Копіювання у файл / в порожній вихід', keys: ['elapsedMs'] },
      { numerator: 'session-busy', denominator: 'session', label: 'Старт сеансу: декодер працює / ні', keys: ['startRunMs', 'firstAddMs'] },
      { numerator: 'ref-sel', denominator: 'ref-full', label: 'Вибірковий / повний', keys: ['elapsedMs', 'bytes'] },
      { numerator: 'ref-full', denominator: 'ref-full-lib', label: 'Повний: з воротами / без', keys: ['elapsedMs', 'firstFrameMs'] },
      { numerator: 'ref-sel', denominator: 'ref-sel-lib', label: 'Вибірковий: з воротами / без', keys: ['elapsedMs', 'firstFrameMs'] },
    ],
  }
}

export function cleanShares(values: number[]): number[] {
  return [...new Set(values.filter((value) => value >= 0 && value <= 1))].sort((a, b) => a - b)
}

export function cleanCounts(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b)
}

export type SeriesId = 'journal' | 'flow' | 'interval' | 'share' | 'cuts' | 'components'

export const SERIES_CHOICES: { id: SeriesId; title: string }[] = [
  { id: 'journal', title: 'Ціна журналу' },
  { id: 'flow', title: 'Ліміт кадрів N' },
  { id: 'interval', title: 'Інтервал контрольних точок' },
  { id: 'share', title: 'Частка ефектів' },
  { id: 'cuts', title: 'Розрізи' },
  { id: 'components', title: 'Складові конвеєра' },
]

export function makeSeries(id: SeriesId, options: SeriesOptions): Series {
  if (id === 'journal') return journalCostSeries(options)
  if (id === 'flow') return flowSeries(options)
  if (id === 'share') return shareSeries(options)
  if (id === 'cuts') return cutsSeries(options)
  if (id === 'components') return componentsSeries(options)
  return intervalSeries(options)
}
