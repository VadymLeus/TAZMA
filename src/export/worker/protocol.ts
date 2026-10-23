// src/export/worker/protocol.ts
import { ExportAborted } from '../types.ts'
import type { ExportProgress, ExportProject, ExportResult, ExportSettings } from '../types.ts'

// An error as it crosses between the page and the worker: only these three
// things survive, and the name is what the page needs to tell a cancelled
// export or a failed decoder from the rest.
export interface WireError {
  name: string
  message: string
  stack?: string
}

// A result as it leaves the worker: everything but the function that frees the
// file; the page makes its own, from the name of the file.
export type WireResult = Omit<ExportResult, 'release'>

export type ToWorker =
  | { type: 'start'; project: ExportProject; settings: ExportSettings; resumeJob?: string }
  | { type: 'abort' }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'done'; result: WireResult }
  | { type: 'error'; error: WireError }

export function toWireError(error: unknown): WireError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
  }
  return { name: 'Error', message: String(error) }
}

export function fromWireError(wire: WireError): Error {
  if (wire.name === 'AbortError') return new ExportAborted()
  const error = new Error(wire.message)
  error.name = wire.name
  if (wire.stack) error.stack = wire.stack
  return error
}
