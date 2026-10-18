// src/components/TextOverlay.tsx
import { useEffect, useRef } from 'react'
import { drawTexts } from '../render/overlay.ts'
import type { TextItem } from '../project/types.ts'

export default function TextOverlay({ texts }: { texts: TextItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const redraw = useRef<() => void>(() => {})

  useEffect(() => {
    redraw.current = () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const ratio = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.clearRect(0, 0, width, height)
      drawTexts(ctx, width, height, texts)
    }
    redraw.current()
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => redraw.current())
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  return <canvas ref={canvasRef} className="overlay" aria-hidden="true" />
}
