// src/gif/gifImport.ts
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  getFirstEncodableVideoCodec,
} from 'mediabunny'
import { frameMicro } from './timing.ts'

export interface GifProgress {
  done: number
  total: number
}

// The editor reads video through Mediabunny, which does not know GIF. The
// browser decodes the GIF frame by frame, with the delays it was made with, and
// the frames are written again as an MP4 that goes into the project as any
// other source. Transparent areas are laid on black, like the editor's frame.
// MP4 is used because it stores the length of every frame, the last one
// included; a WebM leaves it out and the clip would end a frame early.
export async function gifToVideo(
  file: File,
  onProgress?: (progress: GifProgress) => void,
): Promise<File> {
  if (typeof ImageDecoder === 'undefined') {
    throw new Error('цей браузер не вміє розбирати GIF (потрібен Chrome або Edge)')
  }
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' })
  let output: Output | null = null
  try {
    await decoder.tracks.ready
    await decoder.completed
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0
    if (count === 0) throw new Error('у GIF немає кадрів')

    const target = new BufferTarget()
    let canvas: OffscreenCanvas | null = null
    let ctx: OffscreenCanvasRenderingContext2D | null = null
    let source: CanvasSource | null = null
    let elapsed = 0

    for (let index = 0; index < count; index++) {
      const { image } = await decoder.decode({ frameIndex: index })
      try {
        if (!source || !canvas || !ctx) {
          const width = image.displayWidth
          const height = image.displayHeight
          const format = new Mp4OutputFormat({ fastStart: 'in-memory' })
          const codec = await getFirstEncodableVideoCodec(
            format.getSupportedVideoCodecs().filter((c) => c === 'vp9' || c === 'avc'),
            { width, height },
          )
          if (!codec) throw new Error('цей браузер не вміє кодувати VP9 або H.264')
          canvas = new OffscreenCanvas(width, height)
          ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('не вдалося створити полотно для кадрів')
          output = new Output({ format, target })
          source = new CanvasSource(canvas, { codec, quality: QUALITY_VERY_HIGH })
          output.addVideoTrack(source)
          await output.start()
        }
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0)
        const micro = frameMicro(image.duration, count === 1)
        await source.add(elapsed / 1e6, micro / 1e6)
        elapsed += micro
      } finally {
        image.close()
      }
      onProgress?.({ done: index + 1, total: count })
    }
    source?.close()
    await output?.finalize()
    return new File([target.buffer!], file.name, { type: 'video/mp4' })
  } catch (error) {
    const pending = output as Output | null
    if (pending && pending.state !== 'finalized' && pending.state !== 'canceled') {
      await pending.cancel().catch(() => {})
    }
    throw error
  } finally {
    decoder.close()
  }
}
