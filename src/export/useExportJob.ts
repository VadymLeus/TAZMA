// src/export/useExportJob.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { exportProject } from './exportProject.ts'
import type { ExportProject } from './exportProject.ts'
import { ExportAborted } from './types.ts'
import type { ExportProgress, ExportResult, ExportSettings } from './types.ts'

export type JobState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: ExportProgress | null; startedAt: number }
  | { phase: 'done'; result: ExportResult; url: string }
  | { phase: 'error'; message: string }

const PROGRESS_INTERVAL = 100

// Runs one export at a time and keeps its progress, result and download link.
export function useExportJob() {
  const [state, setState] = useState<JobState>({ phase: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)

  const releaseUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }, [])

  const start = useCallback(
    async (project: ExportProject, settings: ExportSettings) => {
      controllerRef.current?.abort()
      releaseUrl()
      const controller = new AbortController()
      controllerRef.current = controller
      const startedAt = performance.now()
      let lastReport = 0
      setState({ phase: 'running', progress: null, startedAt })
      try {
        const result = await exportProject(project, settings, {
          signal: controller.signal,
          onProgress: (progress) => {
            const now = performance.now()
            const finished = progress.time >= progress.total
            if (controllerRef.current !== controller) return
            if (!finished && now - lastReport < PROGRESS_INTERVAL) return
            lastReport = now
            setState({ phase: 'running', progress, startedAt })
          },
        })
        if (controllerRef.current !== controller) return
        const url = URL.createObjectURL(result.blob)
        urlRef.current = url
        setState({ phase: 'done', result, url })
      } catch (error) {
        if (controllerRef.current !== controller) return
        if (error instanceof ExportAborted) {
          setState({ phase: 'idle' })
        } else {
          const message = error instanceof Error ? error.message : String(error)
          setState({ phase: 'error', message })
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    },
    [releaseUrl],
  )

  const cancel = useCallback(() => controllerRef.current?.abort(), [])

  const reset = useCallback(() => {
    releaseUrl()
    setState({ phase: 'idle' })
  }, [releaseUrl])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
      releaseUrl()
    },
    [releaseUrl],
  )

  return { state, start, cancel, reset }
}
