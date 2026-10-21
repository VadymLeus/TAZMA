// src/export/worker/exportWorker.ts
import { runExport } from '../runExport.ts'
import { toWireError } from './protocol.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import type { ExportProject, ExportSettings } from '../types.ts'

interface Scope {
  postMessage(message: FromWorker): void
  onmessage: ((event: { data: ToWorker }) => void) | null
}

const scope = self as unknown as Scope
const controller = new AbortController()
// The page is told of progress at most this often, in milliseconds.
const PROGRESS_INTERVAL = 50
let started = false

async function run(project: ExportProject, settings: ExportSettings, resumeJob?: string): Promise<void> {
  let last = 0
  try {
    const { release, ...result } = await runExport(project, settings, {
      signal: controller.signal,
      ...(resumeJob !== undefined ? { resumeJob } : {}),
      onProgress: (progress) => {
        const now = performance.now()
        if (progress.time < progress.total && now - last < PROGRESS_INTERVAL) return
        last = now
        scope.postMessage({ type: 'progress', progress })
      },
    })
    scope.postMessage({ type: 'done', result })
  } catch (error) {
    scope.postMessage({ type: 'error', error: toWireError(error) })
  }
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'abort') {
    controller.abort()
    return
  }
  if (started) return
  started = true
  void run(message.project, message.settings, message.resumeJob)
}

scope.postMessage({ type: 'ready' })
