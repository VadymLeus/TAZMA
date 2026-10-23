// src/export/useExportJob.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { measurementOf, saveMeasurement } from '../resume/measure.ts'
import { describeError } from './errors.ts'
import { runExportJob } from './runJob.ts'
import { clearExportFiles } from './sink.ts'
import { ExportAborted } from './types.ts'
import type {
  ExportProgress,
  ExportProject,
  ExportResult,
  ExportSettings,
} from './types.ts'

export type JobState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: ExportProgress | null; startedAt: number }
  | { phase: 'done'; result: ExportResult; url: string }
  | { phase: 'error'; message: string }

const PROGRESS_INTERVAL = 100

export interface StartExtra {
  // Go on with the journal of this job instead of starting an export.
  resumeJob?: string
}

// What an export through the journal showed about its checkpoints is kept for
// the next one to choose the length of a part from.
function rememberCheckpoints(result: ExportResult): void {
  if (!result.journal) return
  const found = measurementOf(result.journal, result.duration)
  if (found) saveMeasurement(result.settings.mode, found)
}

// Runs one export at a time and keeps its progress, result and download link.
export function useExportJob() {
  const [state, setState] = useState<JobState>({ phase: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  const resultRef = useRef<ExportResult | null>(null)

  // The link and the file behind the last result.
  const releaseUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    const previous = resultRef.current
    resultRef.current = null
    if (previous) void previous.release()
  }, [])

  const start = useCallback(
    async (project: ExportProject, settings: ExportSettings, extra: StartExtra = {}) => {
      controllerRef.current?.abort()
      releaseUrl()
      const controller = new AbortController()
      controllerRef.current = controller
      const startedAt = performance.now()
      let lastReport = 0
      setState({ phase: 'running', progress: null, startedAt })
      try {
        const result = await runExportJob(project, settings, {
          signal: controller.signal,
          ...(extra.resumeJob !== undefined ? { resumeJob: extra.resumeJob } : {}),
          onProgress: (progress) => {
            const now = performance.now()
            const finished = progress.time >= progress.total
            if (controllerRef.current !== controller) return
            if (!finished && now - lastReport < PROGRESS_INTERVAL) return
            lastReport = now
            setState({ phase: 'running', progress, startedAt })
          },
        })
        if (controllerRef.current !== controller) {
          void result.release()
          return
        }
        rememberCheckpoints(result)
        const url = URL.createObjectURL(result.blob)
        urlRef.current = url
        resultRef.current = result
        setState({ phase: 'done', result, url })
      } catch (error) {
        if (controllerRef.current !== controller) return
        if (error instanceof ExportAborted) {
          setState({ phase: 'idle' })
        } else {
          setState({ phase: 'error', message: describeError(error) })
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

  useEffect(() => {
    void clearExportFiles()
    return () => {
      controllerRef.current?.abort()
      releaseUrl()
    }
  }, [releaseUrl])

  return { state, start, cancel, reset }
}
