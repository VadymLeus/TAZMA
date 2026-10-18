import { useEffect, useState } from 'react'
import DropZone from './components/DropZone.tsx'
import InfoPanel from './components/InfoPanel.tsx'
import KeyframeStrip from './components/KeyframeStrip.tsx'
import VideoPreview from './components/VideoPreview.tsx'
import { probeFile, scanKeyframes } from './media/probe.ts'
import type { KeyframeInfo, MediaInfo } from './media/probe.ts'

type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [info, setInfo] = useState<Load<MediaInfo>>({ status: 'idle' })
  const [keyframes, setKeyframes] = useState<Load<KeyframeInfo | null>>({
    status: 'idle',
  })

  // Object URL for the preview; released when the file changes.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Read file information, then scan key frames. A newer file cancels the
  // previous run, and results of a cancelled run are ignored.
  useEffect(() => {
    if (!file) return
    const controller = new AbortController()
    const { signal } = controller

    setInfo({ status: 'loading' })
    setKeyframes({ status: 'idle' })

    async function run(current: File) {
      let phase: 'info' | 'keyframes' = 'info'
      try {
        const data = await probeFile(current)
        if (signal.aborted) return
        setInfo({ status: 'ready', data })
        if (!data.video) return

        phase = 'keyframes'
        setKeyframes({ status: 'loading' })
        const found = await scanKeyframes(current, signal)
        if (signal.aborted) return
        setKeyframes({ status: 'ready', data: found })
      } catch (error) {
        if (signal.aborted) return
        const message = errorMessage(error)
        if (phase === 'info') setInfo({ status: 'error', message })
        else setKeyframes({ status: 'error', message })
      }
    }
    void run(file)

    return () => controller.abort()
  }, [file])

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">TAZMA</span>
        <span className="stage">Етап 1 · відкриття відео</span>
      </header>

      {!file && <DropZone onFile={setFile} />}

      {file && (
        <div className="layout">
          <div className="column">
            <section className="card">
              {previewUrl && <VideoPreview url={previewUrl} />}
              <div className="file-bar">
                <span className="file-name" title={file.name}>
                  {file.name}
                </span>
                <DropZone onFile={setFile} compact />
              </div>
            </section>

            {info.status === 'ready' && info.data.video && (
              <section className="card">
                <h2>Ключові кадри</h2>
                {keyframes.status === 'loading' && (
                  <p className="muted">Читаю ключові кадри…</p>
                )}
                {keyframes.status === 'error' && (
                  <p className="error">
                    Не вдалося прочитати ключові кадри: {keyframes.message}
                  </p>
                )}
                {keyframes.status === 'ready' && keyframes.data && (
                  <KeyframeStrip
                    keyframes={keyframes.data}
                    duration={info.data.duration}
                    frameCount={info.data.video.frameCount}
                  />
                )}
              </section>
            )}
          </div>

          <div className="column">
            {info.status === 'loading' && (
              <section className="card">
                <h2>Дані про файл</h2>
                <p className="muted">Читаю файл…</p>
              </section>
            )}
            {info.status === 'error' && (
              <section className="card">
                <h2>Дані про файл</h2>
                <p className="error">
                  Не вдалося прочитати файл: {info.message}
                </p>
              </section>
            )}
            {info.status === 'ready' && <InfoPanel info={info.data} />}
          </div>
        </div>
      )}
    </div>
  )
}
