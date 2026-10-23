// src/export/planText.ts
import { formatSpan } from '../media/format.ts'
import { avcMismatch } from './avcSets.ts'
import type {
  CopyBlocker,
  PlanSummary,
  RecodeReason,
  SourceStream,
  StreamColor,
  TargetStream,
} from './selectivePlan.ts'
import type { ExportStats } from './types.ts'

export const BLOCKER_LABELS: Record<CopyBlocker, string> = {
  'no-video': 'у файлі немає відео',
  codec: 'кодек файлу інший, ніж обраний',
  size: 'розмір кадру відрізняється від результату',
  rotation: 'файл повернутий',
  params: 'параметри потоку не збігаються з кодувальником',
  color: 'інший колірний простір',
}

export const REASON_LABELS: Record<RecodeReason, string> = {
  effect: 'ефект',
  text: 'написи',
  edge: 'межі GOP',
  short: 'короткі ділянки',
  source: 'файли, які не копіюються',
}

const REASON_ORDER: RecodeReason[] = ['effect', 'text', 'edge', 'short', 'source']

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0

// "Copied 38,0 s of 40,0 s (95 %). Recoded 2,0 s: captions 1,2 s · GOP edges 0,8 s."
export function planSentence(summary: PlanSummary): string {
  const total = summary.copySeconds + summary.recodeSeconds
  if (total <= 0) return 'Немає що експортувати.'
  const causes = REASON_ORDER.filter((reason) => summary.byReason[reason] > 0.005)
    .map((reason) => `${REASON_LABELS[reason]} ${formatSpan(summary.byReason[reason])}`)
    .join(' · ')
  const copied = `Копіюється ${formatSpan(summary.copySeconds)} з ${formatSpan(total)} (${percent(summary.copySeconds, total)} %).`
  if (summary.recodeSeconds <= 0.005) return `${copied} Перераховувати нічого не треба.`
  return `${copied} Перераховується ${formatSpan(summary.recodeSeconds)}: ${causes}.`
}

function describeColor(color: StreamColor | null | undefined): string {
  if (!color) return 'не вказано'
  const field = (value: string | null | undefined) => value ?? '—'
  const range = color.fullRange == null ? '—' : color.fullRange ? 'повний' : 'обмежений'
  return `${field(color.primaries)} / ${field(color.transfer)} / ${field(color.matrix)}, діапазон ${range}`
}

const sizeOf = (bytes: Uint8Array | null) => (bytes ? `${bytes.length} Б` : 'немає')

// The values behind one reason, so a mismatch can be seen and not guessed at.
export function blockerDetail(
  blocker: CopyBlocker,
  source: SourceStream | null,
  target: TargetStream,
): string | null {
  if (!source) return null
  switch (blocker) {
    case 'codec':
      return `кодек: файл ${source.codec ?? '—'}, результат ${target.codec}`
    case 'rotation':
      return `поворот файлу ${source.rotation}°`
    case 'size':
      return `кадр: файл ${source.width}×${source.height}, результат ${target.width}×${target.height}`
    case 'color':
      return `колірний простір: файл ${describeColor(source.color)}; кодувальник ${describeColor(target.color)}`
    case 'params':
      if (target.codec === 'avc') {
        const reason = avcMismatch(source.description, target.description) ?? 'різні параметри'
        return `опис H.264: файл ${source.codecString ?? '—'}, кодувальник ${target.codecString}; ${reason}`
      }
      return target.codec === 'hevc'
        ? `набори параметрів: файл ${source.codecString ?? '—'} (${sizeOf(source.description)}), кодувальник ${target.codecString} (${sizeOf(target.description)}); байти різні`
        : `профіль: файл ${source.codecString ?? '—'}, кодувальник ${target.codecString}`
    default:
      return null
  }
}

export interface BlockerLine {
  headline: string
  details: string[]
}

export function blockerLines(
  blockers: Iterable<[string, CopyBlocker[]]>,
  nameOf: (sourceId: string) => string,
  streamOf: (sourceId: string) => SourceStream | null,
  target: TargetStream,
): BlockerLine[] {
  const lines: BlockerLine[] = []
  for (const [sourceId, found] of blockers) {
    const first = found[0]
    if (first === undefined) continue
    const source = streamOf(sourceId)
    lines.push({
      headline: `${nameOf(sourceId)}: ${BLOCKER_LABELS[first]}`,
      details: found
        .map((blocker) => blockerDetail(blocker, source, target))
        .filter((text): text is string => text !== null),
    })
  }
  return lines
}

// The line under a finished export.
export function statsSentence(stats: ExportStats): string {
  const total = stats.framesCopied + stats.framesRecoded
  if (stats.mode === 'full') return `Усі ${total} кадрів перераховано`
  const share = percent(stats.framesCopied, total)
  const base = `Скопійовано ${stats.framesCopied} з ${total} кадрів (${share} %), перераховано ${stats.framesRecoded}`
  return stats.fallbackGops > 0
    ? `${base}; ${stats.fallbackGops} GOP із відкритою структурою перераховано`
    : base
}
