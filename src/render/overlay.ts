// src/render/overlay.ts
import type { TextItem } from '../project/types.ts'

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Draws captions on a frame of the given pixel size. The preview and the
// export both call this, so the file contains what the preview showed.
export function drawTexts(
  ctx: Context,
  width: number,
  height: number,
  texts: TextItem[],
): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const item of texts) {
    const lines = item.text.split('\n')
    const fontSize = item.size * height
    const lineHeight = fontSize * 1.2
    ctx.font = `600 ${fontSize}px system-ui, "Segoe UI", sans-serif`
    ctx.lineWidth = fontSize * 0.12
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.fillStyle = item.color
    const x = item.x * width
    const top = item.y * height - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, index) => {
      const y = top + index * lineHeight
      ctx.strokeText(line, x, y)
      ctx.fillText(line, x, y)
    })
  }
  ctx.restore()
}
