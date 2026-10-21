// src/export/runJob.ts
import { watchResponsiveness } from '../diagnostics/responsiveness.ts'
import { runExport } from './runExport.ts'
import { clearExportFiles, removeExportFile } from './sink.ts'
import { WorkerUnavailable, runInWorker } from './worker/client.ts'
import type { WorkerFactory, WorkerLike } from './worker/client.ts'
import type { ExportOptions, ExportProject, ExportResult, ExportSettings } from './types.ts'

export interface JobDeps {
  // Makes the worker; the page's own code by default.
  createWorker?: WorkerFactory
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./worker/exportWorker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike
}

// Runs an export where the settings say: in a worker of its own, or on the
// page. If the worker cannot be started the export runs on the page and the
// result says so. Whichever thread it was, the page's freezes during the
// export are counted.
export async function runExportJob(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions = {},
  deps: JobDeps = {},
): Promise<ExportResult> {
  const watch = watchResponsiveness()
  try {
    const create = deps.createWorker ?? (typeof Worker === 'undefined' ? null : defaultWorker)
    let result: ExportResult
    let thread: 'worker' | 'main' = 'main'
    let note: string | null = null
    if (settings.inWorker !== false && create) {
      try {
        result = await runInWorker(
          project,
          settings,
          {
            ...options,
            discard: removeExportFile,
            cleanup: clearExportFiles,
          },
          create,
        )
        thread = 'worker'
      } catch (error) {
        if (!(error instanceof WorkerUnavailable)) throw error
        note = `Фоновий потік не запустився (${error.message}), експорт виконано в основному потоці.`
        result = await runExport(project, settings, options)
      }
    } else {
      result = await runExport(project, settings, options)
    }
    return {
      ...result,
      thread,
      ui: watch.stop(),
      notes: note ? [...(result.notes ?? []), note] : result.notes,
    }
  } finally {
    watch.stop()
  }
}
