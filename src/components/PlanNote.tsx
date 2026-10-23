// src/components/PlanNote.tsx
import { blockerLines, planSentence } from '../export/planText.ts'
import type { ProjectPlan } from '../export/selectiveAnalysis.ts'
import type { Source } from '../project/types.ts'

export type PlanState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; plan: ProjectPlan }
  | { phase: 'error'; message: string }

// What a selective export would copy and what stands in the way, before it is
// started.
export default function PlanNote({ state, sources }: { state: PlanState; sources: Source[] }) {
  if (state.phase === 'idle') return null
  if (state.phase === 'loading') {
    return <p className="muted export-plan">Аналізую ключові кадри файлів…</p>
  }
  if (state.phase === 'error') {
    return <p className="error export-plan">Не вдалося скласти план: {state.message}</p>
  }
  const nameOf = (sourceId: string) => sources.find((source) => source.id === sourceId)?.info.fileName ?? sourceId
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
