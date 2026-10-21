// src/export/worker/client.ts
import { ExportAborted } from '../types.ts'
import type { ExportOptions, ExportProject, ExportResult, ExportSettings } from '../types.ts'
import { fromWireError } from './protocol.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

// The part of a Worker the client uses, so that a fake can stand in for it.
export interface WorkerLike {
  postMessage(message: ToWorker): void
  terminate(): void
  onmessage: ((event: { data: FromWorker }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
  onmessageerror: ((event: unknown) => void) | null
}

export type WorkerFactory = () => WorkerLike

// The worker could not be started at all; the export can run on the page.
export class WorkerUnavailable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'WorkerUnavailable'
  }
}

export interface WorkerRunOptions extends Pick<ExportOptions, 'onProgress' | 'signal' | 'resumeJob'> {
  // Frees a file of the private storage by name.
  discard: (file: string) => Promise<void>
  // Removes what a worker that was stopped by force may have left behind.
  cleanup?: () => Promise<void>
  // How long a cancelled export may take to stop by itself, in milliseconds.
  abortGrace?: number
}

const ABORT_GRACE = 5000

// Runs one export in a worker of its own and gives back its result. The worker
// is made for this export and ends with it. A cancelled export is asked to
// stop; if it does not, the worker is ended and the file it was writing is
// removed.
export function runInWorker(
  project: ExportProject,
  settings: ExportSettings,
  options: WorkerRunOptions,
  create: WorkerFactory,
): Promise<ExportResult> {
  const { signal, onProgress, discard, cleanup, resumeJob } = options
  const grace = options.abortGrace ?? ABORT_GRACE
  if (signal?.aborted) return Promise.reject(new ExportAborted())
  return new Promise<ExportResult>((resolve, reject) => {
    let worker: WorkerLike
    try {
      worker = create()
    } catch (error) {
      reject(new WorkerUnavailable(error instanceof Error ? error.message : String(error)))
      return
    }
    let ready = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      action()
    }

    function onAbort(): void {
      if (settled) return
      worker.postMessage({ type: 'abort' })
      timer = setTimeout(() => {
        finish(() => {
          void cleanup?.()
          reject(new ExportAborted())
        })
      }, grace)
    }

    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'ready') {
        ready = true
      } else if (message.type === 'progress') {
        onProgress?.(message.progress)
      } else if (message.type === 'done') {
        const wire = message.result
        const file = wire.file ?? null
        finish(() =>
          resolve({ ...wire, release: () => (file ? discard(file) : Promise.resolve()) }),
        )
      } else if (message.type === 'error') {
        finish(() => reject(fromWireError(message.error)))
      }
    }
    worker.onerror = (event) => {
      const reason = event.message || (ready ? 'без пояснення' : 'скрипт не завантажився')
      finish(() => {
        void cleanup?.()
        reject(
          ready
            ? new Error(`Фоновий потік зупинився: ${reason}`)
            : new WorkerUnavailable(reason),
        )
      })
    }
    worker.onmessageerror = () => {
      finish(() => reject(new Error('Фоновий потік надіслав дані, яких не вдалося прочитати.')))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    worker.postMessage({
      type: 'start',
      project,
      settings,
      ...(resumeJob !== undefined ? { resumeJob } : {}),
    })
  })
}
