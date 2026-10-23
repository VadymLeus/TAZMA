// src/stand/bench/benchWorker.ts
import { toWireError } from '../../export/worker/protocol.ts'
import { runBench } from './benchCore.ts'
import type { FromBench, ToBench } from './protocol.ts'

interface Scope {
  postMessage(message: FromBench): void
  onmessage: ((event: { data: ToBench }) => void) | null
}

const scope = self as unknown as Scope
const controller = new AbortController()
let started = false

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'abort') {
    controller.abort()
    return
  }
  if (started) return
  started = true
  runBench(message.spec, controller.signal).then(
    (output) => scope.postMessage({ type: 'done', output }),
    (error: unknown) => scope.postMessage({ type: 'error', error: toWireError(error) }),
  )
}

scope.postMessage({ type: 'ready' })
