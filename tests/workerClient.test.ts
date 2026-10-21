// tests/workerClient.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WorkerUnavailable, runInWorker } from '../src/export/worker/client.ts'
import type { WorkerLike } from '../src/export/worker/client.ts'
import type { FromWorker, ToWorker, WireResult } from '../src/export/worker/protocol.ts'
import { fromWireError, toWireError } from '../src/export/worker/protocol.ts'
import { ExportAborted } from '../src/export/types.ts'
import type { ExportProject, ExportSettings } from '../src/export/types.ts'

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = []
  terminated = 0
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null
  postMessage(message: ToWorker) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated++
  }
  say(message: FromWorker) {
    this.onmessage?.({ data: message })
  }
}

const project = { clips: [], texts: [], sources: [] } as unknown as ExportProject
const settings = { container: 'mp4' } as unknown as ExportSettings
const wire = (file: string | null): WireResult =>
  ({ bytes: 10, frames: 3, file }) as unknown as WireResult

function setup(extra: Partial<Parameters<typeof runInWorker>[2]> = {}) {
  const worker = new FakeWorker()
  const discarded: string[] = []
  const progress: number[] = []
  let cleaned = 0
  const controller = new AbortController()
  const promise = runInWorker(
    project,
    settings,
    {
      signal: controller.signal,
      onProgress: (p) => progress.push(p.time),
      discard: async (file) => {
        discarded.push(file)
      },
      cleanup: async () => {
        cleaned++
      },
      abortGrace: 20,
      ...extra,
    },
    () => worker,
  )
  return { worker, discarded, progress, controller, promise, cleaned: () => cleaned }
}

describe('runInWorker', () => {
  it('sends the project and the settings to start', async () => {
    const { worker, promise } = setup()
    assert.deepEqual(worker.sent, [{ type: 'start', project, settings }])
    worker.say({ type: 'done', result: wire(null) })
    await promise
  })

  it('passes progress on and gives the result back, then ends the worker', async () => {
    const { worker, progress, promise } = setup()
    worker.say({ type: 'ready' })
    worker.say({ type: 'progress', progress: { time: 1, total: 4, frames: 30 } })
    worker.say({ type: 'progress', progress: { time: 2, total: 4, frames: 60 } })
    worker.say({ type: 'done', result: wire('export-1.mp4') })
    const result = await promise
    assert.deepEqual(progress, [1, 2])
    assert.equal(result.bytes, 10)
    assert.equal(worker.terminated, 1)
  })

  it('frees the file of the result by its name, and only when asked', async () => {
    const { worker, discarded, promise } = setup()
    worker.say({ type: 'done', result: wire('export-1.mp4') })
    const result = await promise
    assert.deepEqual(discarded, [])
    await result.release()
    assert.deepEqual(discarded, ['export-1.mp4'])
  })

  it('has nothing to free for a result that is in memory', async () => {
    const { worker, discarded, promise } = setup()
    worker.say({ type: 'done', result: wire(null) })
    await (await promise).release()
    assert.deepEqual(discarded, [])
  })

  it('gives the error of the worker back with its name', async () => {
    const { worker, promise } = setup()
    worker.say({ type: 'error', error: { name: 'EncodingError', message: 'Decoding error.' } })
    await assert.rejects(promise, (error: Error) => {
      assert.equal(error.name, 'EncodingError')
      assert.equal(error.message, 'Decoding error.')
      return true
    })
    assert.equal(worker.terminated, 1)
  })

  it('asks the worker to stop when cancelled, and takes its answer', async () => {
    const { worker, controller, promise } = setup({ abortGrace: 1000 })
    worker.say({ type: 'ready' })
    controller.abort()
    assert.deepEqual(worker.sent[1], { type: 'abort' })
    worker.say({ type: 'error', error: { name: 'AbortError', message: 'Експорт скасовано' } })
    await assert.rejects(promise, ExportAborted)
    assert.equal(worker.terminated, 1)
  })

  it('ends a worker that does not stop, and clears what it was writing', async () => {
    const { worker, controller, promise, cleaned } = setup({ abortGrace: 10 })
    worker.say({ type: 'ready' })
    controller.abort()
    await assert.rejects(promise, ExportAborted)
    assert.equal(worker.terminated, 1)
    assert.equal(cleaned(), 1)
  })

  it('does not start a worker for an export that is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    let made = 0
    await assert.rejects(
      runInWorker(project, settings, { signal: controller.signal, discard: async () => {} }, () => {
        made++
        return new FakeWorker()
      }),
      ExportAborted,
    )
    assert.equal(made, 0)
  })

  it('calls a worker that fails before it is ready unavailable', async () => {
    const { worker, promise } = setup()
    worker.onerror?.({ message: 'module scripts are not supported' })
    await assert.rejects(promise, (error: Error) => {
      assert.ok(error instanceof WorkerUnavailable)
      assert.match(error.message, /module scripts/)
      return true
    })
  })

  it('calls a worker that cannot be made unavailable too', async () => {
    await assert.rejects(
      runInWorker(project, settings, { discard: async () => {} }, () => {
        throw new Error('SecurityError')
      }),
      WorkerUnavailable,
    )
  })

  it('reports a worker that stops after it was ready as an ordinary failure', async () => {
    const { worker, promise, cleaned } = setup()
    worker.say({ type: 'ready' })
    worker.onerror?.({ message: 'out of memory' })
    await assert.rejects(promise, (error: Error) => {
      assert.ok(!(error instanceof WorkerUnavailable))
      assert.match(error.message, /Фоновий потік зупинився: out of memory/)
      return true
    })
    assert.equal(cleaned(), 1)
  })

  it('ignores whatever the worker says once it is done', async () => {
    const { worker, progress, promise } = setup()
    worker.say({ type: 'done', result: wire(null) })
    await promise
    worker.say({ type: 'progress', progress: { time: 9, total: 9, frames: 1 } })
    assert.deepEqual(progress, [])
  })
})

describe('errors on the wire', () => {
  it('keeps the name, message and stack of an error', () => {
    const error = new Error('Decoding error.')
    error.name = 'EncodingError'
    const back = fromWireError(toWireError(error))
    assert.equal(back.name, 'EncodingError')
    assert.equal(back.message, 'Decoding error.')
    assert.equal(back.stack, error.stack)
  })

  it('makes a cancelled export out of an abort', () => {
    assert.ok(fromWireError({ name: 'AbortError', message: 'x' }) instanceof ExportAborted)
  })

  it('wraps what is not an Error', () => {
    assert.deepEqual(toWireError('boom'), { name: 'Error', message: 'boom' })
  })
})
