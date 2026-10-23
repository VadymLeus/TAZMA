// src/components/FlowControls.tsx
import type { ChangeEvent } from 'react'
import { FLOW_LIMITS, MEMORY_BUDGETS } from '../export/settings.ts'
import type { ExportSettings, FlowChoice } from '../export/types.ts'

const FLOW_LABELS: Record<FlowChoice, string> = {
  auto: 'Авто: ліміт із виміру',
  fixed: 'Вручну: свій ліміт',
  library: 'Бібліотека: без свого ліміту',
}

const FLOW_NOTES: Record<FlowChoice, string> = {
  auto: 'Ліміт N — це мінімум із двох: скільки кадрів вміщає бюджет пам’яті (після двох кадрів кодувальника, що тримаються завжди) і скільки потрібно, щоб найповільніший етап не простоював. Швидкість кадрів програма міряє сама на початку експорту.',
  fixed: 'Не більше N кадрів одночасно від декодера до кодувальника. Якщо N замале, експорт може сповільнитись.',
  library: 'Черги кадрів задає бібліотека Mediabunny: до 8 декодованих кадрів і ще кілька в кодувальнику.',
}

interface FlowControlsProps {
  settings: ExportSettings
  change: (patch: Partial<ExportSettings>) => void
}

export default function FlowControls({ settings, change }: FlowControlsProps) {
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Конвеєр кадрів</span>
          <select
            value={settings.flow}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              change({ flow: event.target.value as FlowChoice })
            }
          >
            {(Object.keys(FLOW_LABELS) as FlowChoice[]).map((choice) => (
              <option key={choice} value={choice}>
                {FLOW_LABELS[choice]}
              </option>
            ))}
          </select>
        </label>
        {settings.flow === 'auto' && (
          <label className="field">
            <span>Бюджет пам’яті на кадри</span>
            <select
              value={settings.memoryBudget}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                change({ memoryBudget: Number(event.target.value) })
              }
            >
              {MEMORY_BUDGETS.map((budget) => (
                <option key={budget} value={budget}>
                  {budget} МБ
                </option>
              ))}
            </select>
          </label>
        )}
        {settings.flow === 'fixed' && (
          <label className="field">
            <span>Ліміт N, кадрів</span>
            <select
              value={settings.flowLimit}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                change({ flowLimit: Number(event.target.value) })
              }
            >
              {FLOW_LIMITS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="muted export-note">{FLOW_NOTES[settings.flow]}</p>
    </>
  )
}
