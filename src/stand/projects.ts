// src/stand/projects.ts
import type { ExportProject } from '../export/types.ts'
import type { Clip, Source, TextItem } from '../project/types.ts'
import { MIN_TEXT } from '../project/texts.ts'
import { MIN_CLIP } from '../project/timeline.ts'
import { mulberry32 } from './schedule.ts'

// How an experiment project is cut from one source file.
export interface ProjectSpec {
  // Seconds of the file taken from its start; 0 or missing takes all of it.
  seconds?: number
  // Cuts made inside the stretch, at places that are not on key frames: each
  // one splits a group of frames and makes the planner encode its edges again.
  cuts: number
  // The share (0 to 1) of the timeline that has to be encoded again because of
  // an effect, as one stretch in the middle.
  share: number
  // The stretch is covered by a caption, or is a clip with an effect.
  kind: 'text' | 'effect'
  seed?: number
}

export const WHOLE: ProjectSpec = { cuts: 0, share: 0, kind: 'text' }

const roundMs = (value: number) => Math.round(value * 1000) / 1000

function checkShare(share: number): void {
  if (!(share >= 0 && share <= 1)) throw new RangeError('Частка має бути від 0 до 1.')
}

// The project of one experiment: the same stretch of one file in every run, so
// that conditions differ only by what the experiment changes. The cuts do not
// change what is seen, since the pieces follow one another in the file.
export function buildProject(source: Source, spec: ProjectSpec): ExportProject {
  checkShare(spec.share)
  if (!Number.isInteger(spec.cuts) || spec.cuts < 0) throw new RangeError('Число розрізів — ціле, не менше 0.')
  const full = source.info.duration
  const length = spec.seconds && spec.seconds > 0 ? Math.min(spec.seconds, full) : full
  if (!(length >= (spec.cuts + 3) * MIN_CLIP * 2)) throw new RangeError('Фрагмент закороткий для такого числа розрізів.')

  const random = mulberry32(spec.seed ?? 1)
  const points = new Set<number>()
  for (let i = 1; i <= spec.cuts; i++) {
    points.add(roundMs((length * (i + (random() - 0.5) * 0.6)) / (spec.cuts + 1)))
  }

  // The stretch of the effect, centred.
  const span = spec.share * length
  const from = roundMs((length - span) / 2)
  const to = roundMs(from + span)
  const covers = span > 0
  if (covers && spec.kind === 'effect') {
    if (from > MIN_CLIP) points.add(from)
    if (length - to > MIN_CLIP) points.add(to)
  }

  const edges = [0, ...[...points].sort((a, b) => a - b), roundMs(length)]
  const clips: Clip[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i]
    const end = edges[i + 1]
    if (end - start < MIN_CLIP) continue
    const inside = covers && spec.kind === 'effect' && start >= from - 1e-6 && end <= to + 1e-6
    clips.push({
      id: `c${clips.length}`,
      sourceId: source.id,
      start,
      end,
      ...(inside ? { effect: { kind: 'grayscale' as const, amount: 1 } } : {}),
    })
  }

  const texts: TextItem[] = []
  if (covers && spec.kind === 'text') {
    const end = Math.min(length, Math.max(to, from + MIN_TEXT))
    texts.push({ id: 't0', text: 'TAZMA', start: from, end, x: 0.5, y: 0.85, size: 0.07, color: '#ffffff' })
  }
  return { clips, texts, sources: [source] }
}
