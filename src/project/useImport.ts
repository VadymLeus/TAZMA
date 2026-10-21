// src/project/useImport.ts
import { useCallback, useState } from 'react'
import type { Dispatch } from 'react'
import { gifToVideo } from '../gif/gifImport.ts'
import { isGif } from '../gif/timing.ts'
import { probeFile } from '../media/probe.ts'
import type { ProjectAction } from './projectReducer.ts'

export function useImport(dispatch: Dispatch<ProjectAction>) {
  const [pending, setPending] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)

  const convertGif = useCallback((file: File) => {
    let shown = 0
    return gifToVideo(file, ({ done, total }) => {
      // Not every frame: the text would be rewritten faster than it can be read.
      if (done < total && done - shown < 5) return
      shown = done
      setStatus(`Розбираю GIF ${file.name}: кадр ${done} з ${total}…`)
    })
  }, [])

  const importFiles = useCallback(
    async (files: File[]) => {
      setErrors([])
      setPending((count) => count + files.length)
      for (const file of files) {
        try {
          const source = isGif(file) ? await convertGif(file) : file
          const info = await probeFile(source)
          if (!(info.duration > 0)) throw new Error('у файлі немає медіаданих')
          dispatch({
            type: 'addSource',
            source: {
              id: crypto.randomUUID(),
              file: source,
              url: URL.createObjectURL(source),
              info,
            },
            clipId: crypto.randomUUID(),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setErrors((list) => [...list, `${file.name}: ${message}`])
        } finally {
          setPending((count) => count - 1)
          setStatus(null)
        }
      }
    },
    [dispatch, convertGif],
  )

  return { importFiles, pending, errors, status }
}
