// src/components/Inspector.tsx
import { useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { formatDuration } from '../media/format.ts'
import { EFFECTS } from '../project/effects.ts'
import { clipLength } from '../project/timeline.ts'
import type { TextPatch } from '../project/texts.ts'
import { MAX_SIZE, MIN_SIZE } from '../project/texts.ts'
import type { Clip, Effect, TextItem } from '../project/types.ts'

const round2 = (value: number) => Math.round(value * 100) / 100

// Typed numbers are applied on blur or Enter, so half-typed values are never clamped.
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    setDraft(null)
    const number = Number(draft.replace(',', '.'))
    if (draft.trim() !== '' && Number.isFinite(number)) onCommit(number)
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        value={draft ?? String(round2(value))}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>
        {label} · {value} %
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(Number(event.target.value))
        }
      />
    </label>
  )
}

interface InspectorProps {
  clip: Clip | null
  clipName: string
  text: TextItem | null
  playhead: number
  onEffect: (effect: Effect | null) => void
  onText: (patch: TextPatch) => void
}

export default function Inspector({
  clip,
  clipName,
  text,
  playhead,
  onEffect,
  onText,
}: InspectorProps) {
  if (text) {
    return (
      <section className="card">
        <h2>Текст</h2>
        <label className="field">
          <span>Напис</span>
          <textarea
            rows={2}
            value={text.text}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              onText({ text: event.target.value })
            }
          />
        </label>
        <div className="field-row">
          <NumberField
            label="Початок, с"
            value={text.start}
            onCommit={(start) => onText({ start })}
          />
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onText({ start: playhead })}
            title="Початок = положення курсора"
          >
            = курсор
          </button>
        </div>
        <div className="field-row">
          <NumberField
            label="Кінець, с"
            value={text.end}
            onCommit={(end) => onText({ end })}
          />
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onText({ end: playhead })}
            title="Кінець = положення курсора"
          >
            = курсор
          </button>
        </div>
        <RangeField
          label="Положення по горизонталі"
          value={Math.round(text.x * 100)}
          min={0}
          max={100}
          onChange={(value) => onText({ x: value / 100 })}
        />
        <RangeField
          label="Положення по вертикалі"
          value={Math.round(text.y * 100)}
          min={0}
          max={100}
          onChange={(value) => onText({ y: value / 100 })}
        />
        <RangeField
          label="Розмір"
          value={Math.round(text.size * 100)}
          min={Math.round(MIN_SIZE * 100)}
          max={Math.round(MAX_SIZE * 100)}
          onChange={(value) => onText({ size: value / 100 })}
        />
        <label className="field">
          <span>Колір</span>
          <input
            type="color"
            value={text.color}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onText({ color: event.target.value })
            }
          />
        </label>
      </section>
    )
  }

  if (clip) {
    const kind = clip.effect?.kind ?? ''
    return (
      <section className="card">
        <h2>Кліп</h2>
        <dl className="info inspector-info">
          <dt>Файл</dt>
          <dd className="break">{clipName}</dd>
          <dt>Тривалість</dt>
          <dd>{formatDuration(clipLength(clip))}</dd>
        </dl>
        <label className="field">
          <span>Ефект</span>
          <select
            value={kind}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const chosen = EFFECTS.find((e) => e.kind === event.target.value)
              onEffect(
                chosen
                  ? { kind: chosen.kind, amount: clip.effect?.amount ?? 1 }
                  : null,
              )
            }}
          >
            <option value="">Без ефекту</option>
            {EFFECTS.map((effect) => (
              <option key={effect.kind} value={effect.kind}>
                {effect.label}
              </option>
            ))}
          </select>
        </label>
        <RangeField
          label="Сила"
          value={Math.round((clip.effect?.amount ?? 0) * 100)}
          min={0}
          max={100}
          disabled={!clip.effect}
          onChange={(value) =>
            clip.effect && onEffect({ ...clip.effect, amount: value / 100 })
          }
        />
      </section>
    )
  }

  return null
}
