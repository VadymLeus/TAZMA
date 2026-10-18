// src/project/useImport.ts
import { useCallback, useState } from 'react'
import type { Dispatch } from 'react'
import { probeFile } from '../media/probe.ts'
import type { ProjectAction } from './projectReducer.ts'

export function useImport(dispatch: Dispatch<ProjectAction>) {
  const [pending, setPending] = useState(0)
  const [errors, setErrors] = useState<string[]>([])

  const importFiles = useCallback(
    async (files: File[]) => {
      setErrors([])
      setPending((count) => count + files.length)
      for (const file of files) {
        try {
          const info = await probeFile(file)
          if (!(info.duration > 0)) throw new Error('у файлі немає медіаданих')
          dispatch({
            type: 'addSource',
            source: {
              id: crypto.randomUUID(),
              file,
              url: URL.createObjectURL(file),
              info,
            },
            clipId: crypto.randomUUID(),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setErrors((list) => [...list, `${file.name}: ${message}`])
        } finally {
          setPending((count) => count - 1)
        }
      }
    },
    [dispatch],
  )

  return { importFiles, pending, errors }
}
