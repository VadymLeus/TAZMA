// src/components/useSplitter.ts
import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

const STORAGE_KEY = 'tazma.timelineHeight'
const MIN_PANEL = 180
const MIN_REST = 240
const KEY_STEP = 24
// What the timeline gets before anyone has moved the divider.
const DEFAULT_HEIGHT = '38%'

function stored(): number | null {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(value) && value >= MIN_PANEL ? value : null
  } catch {
    return null
  }
}

function save(value: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(value)))
  } catch {
    // Storage may be blocked; the divider then simply starts at the default.
  }
}

// A horizontal divider between a page's upper part and its bottom panel: the
// height of the panel follows the pointer (or the arrow keys) and is
// remembered. `container` is the element that holds both parts.
export function useSplitter(container: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState<number | null>(stored)
  const dragging = useRef<number | null>(null)
  const latest = useRef<number | null>(height)

  function clamp(value: number): number {
    const room = container.current?.getBoundingClientRect().height ?? window.innerHeight
    const max = Math.max(MIN_PANEL, room - MIN_REST)
    return Math.min(Math.max(value, MIN_PANEL), max)
  }

  function apply(value: number): void {
    const next = clamp(value)
    latest.current = next
    setHeight(next)
  }

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = event.pointerId
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    if (dragging.current !== event.pointerId) return
    const box = container.current?.getBoundingClientRect()
    if (box) apply(box.bottom - event.clientY)
  }

  function onPointerUp(event: PointerEvent<HTMLElement>): void {
    if (dragging.current !== event.pointerId) return
    dragging.current = null
    if (latest.current !== null) save(latest.current)
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const panel = event.currentTarget.nextElementSibling
    const current = latest.current ?? panel?.getBoundingClientRect().height ?? 300
    apply(current + (event.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP))
    if (latest.current !== null) save(latest.current)
  }

  return {
    // Value for the `--panel-h` custom property of the container.
    size: height === null ? DEFAULT_HEIGHT : `${height}px`,
    separatorProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
    },
  }
}
