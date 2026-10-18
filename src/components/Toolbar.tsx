// src/components/Toolbar.tsx
interface ToolbarProps {
  canSplit: boolean
  canDelete: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  canZoomOut: boolean
  onSplit: () => void
  onDelete: () => void
  onMove: (delta: -1 | 1) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

export default function Toolbar({
  canSplit,
  canDelete,
  canMoveLeft,
  canMoveRight,
  canZoomOut,
  onSplit,
  onDelete,
  onMove,
  onZoomIn,
  onZoomOut,
  onFit,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <button
        type="button"
        className="btn"
        disabled={!canSplit}
        onClick={onSplit}
        title="Розрізати кліп у місці курсора (S)"
      >
        Розрізати
      </button>
      <button
        type="button"
        className="btn"
        disabled={!canDelete}
        onClick={onDelete}
        title="Видалити виділений кліп (Delete)"
      >
        Видалити
      </button>
      <button
        type="button"
        className="btn"
        disabled={!canMoveLeft}
        onClick={() => onMove(-1)}
        title="Перемістити кліп ліворуч"
        aria-label="Перемістити кліп ліворуч"
      >
        ←
      </button>
      <button
        type="button"
        className="btn"
        disabled={!canMoveRight}
        onClick={() => onMove(1)}
        title="Перемістити кліп праворуч"
        aria-label="Перемістити кліп праворуч"
      >
        →
      </button>
      <span className="toolbar-spacer" />
      <button
        type="button"
        className="btn"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        title="Зменшити масштаб"
        aria-label="Зменшити масштаб"
      >
        −
      </button>
      <button
        type="button"
        className="btn"
        onClick={onZoomIn}
        title="Збільшити масштаб"
        aria-label="Збільшити масштаб"
      >
        +
      </button>
      <button type="button" className="btn" disabled={!canZoomOut} onClick={onFit}>
        Вписати
      </button>
    </div>
  )
}
