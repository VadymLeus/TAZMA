// src/components/SideTabs.tsx
interface SideTab<T extends string> {
  id: T
  label: string
}

interface SideTabsProps<T extends string> {
  tabs: SideTab<T>[]
  value: T
  onChange: (id: T) => void
}

// The tab strip of a side panel.
export default function SideTabs<T extends string>({ tabs, value, onChange }: SideTabsProps<T>) {
  return (
    <div className="sidetabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={tab.id === value ? 'sidetab sidetab-active' : 'sidetab'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
