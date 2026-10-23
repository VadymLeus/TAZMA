// src/components/PageBar.tsx
import type { ReactNode } from 'react'

export type PageId = 'editor' | 'export' | 'stand'

// What the export page tells the bar about its job, to show on the tab.
export interface ExportBusy {
  phase: 'idle' | 'running' | 'done' | 'error'
  // Whole percent of the video written while the job runs.
  percent: number
}

interface PageBarProps {
  page: PageId
  exportBusy: ExportBusy
  onChange: (page: PageId) => void
}

const ORDER: PageId[] = ['editor', 'export', 'stand']

const LABELS: Record<PageId, string> = {
  editor: 'Редактор',
  export: 'Експорт',
  stand: 'Стенд випробувань',
}

const HINTS: Record<PageId, string> = {
  editor: 'Файли, таймлайн, розрізи й написи',
  export: 'Налаштування, хід і результат експорту',
  stand: 'Серії експортів і заміри для дослідження',
}

const ICONS: Record<PageId, ReactNode> = {
  editor: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M7 4.5v11M13 4.5v11M2.5 8.5H7M13 8.5h4.5M2.5 11.5H7M13 11.5h4.5" />
    </svg>
  ),
  export: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M3.5 13.5v3h13v-3" />
    </svg>
  ),
  stand: (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M3 14.5a7 7 0 1 1 14 0" />
      <path d="M10 14.5l3.5-5" />
      <circle cx="10" cy="14.5" r="1" />
    </svg>
  ),
}

function badgeOf(busy: ExportBusy): { text: string; className: string } | null {
  if (busy.phase === 'running') return { text: `${busy.percent} %`, className: 'tab-badge tab-badge-run' }
  if (busy.phase === 'done') return { text: 'готово', className: 'tab-badge tab-badge-done' }
  if (busy.phase === 'error') return { text: 'помилка', className: 'tab-badge tab-badge-error' }
  return null
}

export default function PageBar({ page, exportBusy, onChange }: PageBarProps) {
  return (
    <nav className="pagebar" aria-label="Сторінки">
      {ORDER.map((id) => {
        const active = id === page
        const badge = id === 'export' ? badgeOf(exportBusy) : null
        return (
          <button
            key={id}
            type="button"
            className={active ? 'pagetab pagetab-active' : 'pagetab'}
            aria-current={active ? 'page' : undefined}
            title={HINTS[id]}
            onClick={() => onChange(id)}
          >
            {ICONS[id]}
            <span>{LABELS[id]}</span>
            {badge && <span className={badge.className}>{badge.text}</span>}
          </button>
        )
      })}
    </nav>
  )
}
