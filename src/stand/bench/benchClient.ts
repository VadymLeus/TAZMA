// src/stand/bench/benchClient.ts
import { ExportAborted } from '../../export/types.ts'
import { fromWireError } from '../../export/worker/protocol.ts'
import type { BenchOutput, BenchSpec, FromBench, ToBench } from './protocol.ts'

// The part of a Worker the client uses, so that a fake can stand in for it.
export interface BenchWorkerLike {
  postMessage(message: ToBench): void
  terminate(): void
  onmessage: ((event: { data: FromBench }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

export function defaultBenchWorker(): BenchWorkerLike {
  return new Worker(new URL('./benchWorker.ts', import.meta.url), { type: 'module' }) as unknown as BenchWorkerLike
}

const ABORT_GRACE = 3000

// Runs one timed run in a worker of its own, which ends with it, like an
// export in the worker does.
export function runBenchInWorker(
  spec: BenchSpec,
  signal?: AbortSignal,
  create: () => BenchWorkerLike = defaultBenchWorker,
  abortGrace = ABORT_GRACE,
): Promise<BenchOutput> {
  if (signal?.aborted) return Promise.reject(new ExportAborted())
  return new Promise<BenchOutput>((resolve, reject) => {
    const worker = create()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const end = (action: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      action()
    }

    function onAbort(): void {
      if (settled) return
      worker.postMessage({ type: 'abort' })
      timer = setTimeout(() => end(() => reject(new ExportAborted())), abortGrace)
    }

    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'done') end(() => resolve(message.output))
      else if (message.type === 'error') end(() => reject(fromWireError(message.error)))
    }
    worker.onerror = (event) => end(() => reject(new Error(`Фоновий потік зупинився: ${event.message || 'без пояснення'}`)))
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.postMessage({ type: 'start', spec })
  })
}
