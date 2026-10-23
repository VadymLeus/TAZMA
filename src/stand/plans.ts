// src/stand/plans.ts
import { BLOCKER_LABELS } from '../export/planText.ts'
import type { CopyBlocker } from '../export/selectivePlan.ts'
import type { ProjectPlan } from '../export/selectiveAnalysis.ts'
import { isVideoSettings } from '../export/types.ts'
import type { ExportProject, ExportSettings, VideoSettings } from '../export/types.ts'
import type { Source } from '../project/types.ts'
import { buildProject } from './projects.ts'
import type { Series } from './series.ts'

// What the plan of a selective export says, as it goes into the records.
export interface PlanFigures {
  // The share of the timeline that would be copied, 0 to 1.
  plannedShare: number | null
  // The reasons that stand in the way of copying, joined with "+".
  blockers: string
}

export function planFigures(plan: ProjectPlan): PlanFigures {
  const covered = plan.summary.copySeconds + plan.summary.recodeSeconds
  const reasons = new Set<string>()
  for (const found of plan.blockers.values()) for (const blocker of found) reasons.add(blocker)
  return {
    plannedShare: covered > 0 ? plan.summary.copySeconds / covered : null,
    blockers: [...reasons].join('+'),
  }
}

// Makes the plan of a project (planProject of the export, given by the caller).
export type Planner = (project: ExportProject, settings: VideoSettings, signal?: AbortSignal) => Promise<ProjectPlan>

// Plans the selective conditions of a series before it starts. The plan does
// not depend on the cuts and the effect of the project, only on the stretch
// and the settings, so one plan per project is made.
export async function planConditions(
  series: Series,
  source: Source,
  base: ExportSettings,
  planner: Planner,
  signal?: AbortSignal,
): Promise<Map<string, PlanFigures>> {
  const figures = new Map<string, PlanFigures>()
  const made = new Map<string, PlanFigures>()
  for (const condition of series.conditions) {
    if (condition.bench) continue
    const settings = { ...base, ...condition.settings }
    if (settings.mode !== 'selective' || !isVideoSettings(settings)) continue
    const key = JSON.stringify(condition.spec)
    let found = made.get(key)
    if (!found) {
      found = planFigures(await planner(buildProject(source, condition.spec), settings, signal))
      made.set(key, found)
    }
    figures.set(condition.id, found)
  }
  return figures
}

// Why a series that is meant to show copying would copy nothing, or null when
// some condition does copy.
export function nothingCopied(figures: Map<string, PlanFigures>): string | null {
  if (figures.size === 0) return null
  const all = [...figures.values()]
  if (all.some((item) => (item.plannedShare ?? 0) >= 0.01)) return null
  const reasons = new Set(
    all.flatMap((item) => item.blockers.split('+')).filter((code): code is CopyBlocker => code in BLOCKER_LABELS),
  )
  const why = reasons.size > 0 ? ` Причина: ${[...reasons].map((code) => BLOCKER_LABELS[code]).join('; ')}.` : ''
  return `Вибірковий експорт нічого не скопіює.${why}`
}
