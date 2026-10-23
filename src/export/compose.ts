// src/export/compose.ts
import type { VideoSample } from 'mediabunny'
import { effectFilter } from '../project/effects.ts'
import { textsAt } from '../project/texts.ts'
import type { Effect, TextItem } from '../project/types.ts'
import { drawTexts } from '../render/overlay.ts'

export type FrameContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

// Paints one output frame: the source frame fitted into the canvas, its clip
// effect, then the captions visible at this time.
export function composeFrame(
  ctx: FrameContext,
  width: number,
  height: number,
  sample: VideoSample,
  effect: Effect | undefined,
  texts: TextItem[],
  time: number,
): void {
  ctx.filter = 'none'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.filter = effectFilter(effect)
  sample.drawWithFit(ctx, { fit: 'contain' })
  ctx.filter = 'none'
  const visible = textsAt(texts, time)
  if (visible.length > 0) drawTexts(ctx, width, height, visible)
}
