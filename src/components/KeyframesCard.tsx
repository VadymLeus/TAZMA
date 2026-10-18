// src/components/KeyframesCard.tsx
import { useEffect, useState } from 'react'
import { scanKeyframes } from '../media/probe.ts'
import type { KeyframeInfo } from '../media/probe.ts'
import type { Source } from '../project/types.ts'
import KeyframeStrip from './KeyframeStrip.tsx'

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: KeyframeInfo | null }
  | { status: 'error'; message: string }

// Scanning a long file takes time, so results are kept per file.
const cache = new WeakMap<File, KeyframeInfo | null>()

export default function KeyframesCard({ source }: { source: Source }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const { file, info } = source

  useEffect(() => {
    if (!info.video) return
    const cached = cache.get(file)
    if (cached !== undefined) {
      setState({ status: 'ready', data: cached })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    scanKeyframes(file, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        cache.set(file, data)
        setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setState({ status: 'error', message })
      })
    return () => controller.abort()
  }, [file, info.video])

  if (!info.video) return null

  return (
    <section className="card">
      <h2>Ключові кадри</h2>
      {state.status === 'loading' && <p className="muted">Читаю ключові кадри…</p>}
      {state.status === 'error' && (
        <p className="error">Не вдалося прочитати ключові кадри: {state.message}</p>
      )}
      {state.status === 'ready' && state.data && (
        <KeyframeStrip
          keyframes={state.data}
          duration={info.duration}
          frameCount={info.video.frameCount}
        />
      )}
    </section>
  )
}
