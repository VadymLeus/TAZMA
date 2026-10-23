// src/components/ExportResult.tsx
import { Fragment } from 'react'
import { AUDIO_LABELS, CONTAINER_LABELS, VIDEO_LABELS } from '../export/codecs.ts'
import { flowRows } from '../export/flowText.ts'
import { journalRows } from '../export/journalText.ts'
import { statsSentence } from '../export/planText.ts'
import { formatRemaining, resultSpeed } from '../export/stats.ts'
import { threadRows } from '../export/threadText.ts'
import type { ExportProgress, ExportResult } from '../export/types.ts'
import { formatBytes, formatSpan } from '../media/format.ts'

const PHASE_VERBS = {
  audio: 'Звук закодовано',
  video: 'Закодовано',
  assemble: 'Зібрано',
}

export function progressText(progress: ExportProgress, remaining: number | null): string {
  const verb = PHASE_VERBS[progress.phase ?? 'video']
  const frames = progress.phase === 'audio' ? '' : ` · ${progress.frames} кадрів`
  const left = remaining !== null ? ` · залишилось ${formatRemaining(remaining)}` : ''
  return `${verb} ${formatSpan(progress.time)} з ${formatSpan(progress.total)}${frames}${left}`
}

function formatLine(result: ExportResult): string {
  const { settings } = result
  if (settings.container === 'gif') {
    return `GIF · ${settings.gifFps} кадр/с${settings.gifDither ? ', з розсіюванням' : ''}${
      settings.gifLoop ? ', циклічний' : ', один раз'
    }, без звуку`
  }
  return `${CONTAINER_LABELS[settings.container]} · ${VIDEO_LABELS[settings.videoCodec] ?? settings.videoCodec}${
    result.hasAudio
      ? ` + ${AUDIO_LABELS[settings.audioCodec] ?? settings.audioCodec}`
      : ', без звуку'
  }`
}

export function ResultInfo({ result }: { result: ExportResult }) {
  const speed = resultSpeed(result)
  const gif = result.settings.container === 'gif'
  const rows: [string, string][] = [
    ['Файл', formatBytes(result.bytes)],
    ['Формат', formatLine(result)],
    ['Кадр', `${result.width}×${result.height}, ${result.frames} кадрів`],
    ...(gif ? [] : ([['Режим', statsSentence(result.stats)]] as [string, string][])),
    ...threadRows(
      result.thread,
      result.ui,
      result.thread === 'worker' && result.memory != null && result.memory.peakHeapBytes === null,
    ),
    ...flowRows(result.flow, result.fallback),
    ...journalRows(result.journal, result.duration),
    ...(result.notes ?? []).map((note): [string, string] => ['Увага', note]),
    ['Тривалість', formatSpan(result.duration)],
    ['Час кодування', formatSpan(result.elapsedMs / 1000)],
    [
      'Швидкість',
      `${Math.round(speed.framesPerSecond)} кадр/с · ×${speed.realtime.toFixed(1).replace('.', ',')} від реального часу`,
    ],
  ]
  return (
    <dl className="info export-result">
      {rows.map(([label, value], index) => (
        <Fragment key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
