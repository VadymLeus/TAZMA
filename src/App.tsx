// src/App.tsx
import { useEffect, useReducer, useRef, useState } from 'react'
import DropZone from './components/DropZone.tsx'
import FileList, { ImportNotes } from './components/FileList.tsx'
import InfoPanel from './components/InfoPanel.tsx'
import KeyframesCard from './components/KeyframesCard.tsx'
import Timeline from './components/Timeline.tsx'
import Toolbar from './components/Toolbar.tsx'
import VideoPreview from './components/VideoPreview.tsx'
import { initialProject, projectReducer } from './project/projectReducer.ts'
import { canSplit, timelineDuration } from './project/timeline.ts'
import { useImport } from './project/useImport.ts'
import { usePlayback } from './project/usePlayback.ts'

const ZOOM_STEP = 1.5
const MAX_ZOOM = 100

export default function App() {
  const [project, dispatch] = useReducer(projectReducer, initialProject)
  const { sources, clips, selectedClipId, activeSourceId } = project
  const { importFiles, pending, errors } = useImport(dispatch)
  const player = usePlayback(clips, sources)
  const [zoom, setZoom] = useState(1)

  const total = timelineDuration(clips)
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null
  const selectedIndex = clips.findIndex((c) => c.id === selectedClipId)

  const split = () =>
    dispatch({ type: 'split', time: player.playhead, newId: crypto.randomUUID() })
  const remove = () => dispatch({ type: 'deleteSelected' })

  const actions = useRef({ split, remove, toggle: player.toggle })
  useEffect(() => {
    actions.current = { split, remove, toggle: player.toggle }
  })

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const tag = (event.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (event.key === ' ' && tag !== 'BUTTON') {
        event.preventDefault()
        actions.current.toggle()
      } else if (event.key === 's' || event.key === 'S') {
        actions.current.split()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        actions.current.remove()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  function removeSource(sourceId: string) {
    const source = sources.find((s) => s.id === sourceId)
    if (source) URL.revokeObjectURL(source.url)
    dispatch({ type: 'removeSource', sourceId })
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">TAZMA</span>
        <span className="stage">Етап 2 · таймлайн</span>
      </header>

      {sources.length === 0 ? (
        <>
          <DropZone onFiles={importFiles} />
          <ImportNotes pending={pending} errors={errors} />
        </>
      ) : (
        <div className="editor">
          <div className="editor-files">
            <FileList
              sources={sources}
              activeSourceId={activeSourceId}
              pending={pending}
              errors={errors}
              onFiles={importFiles}
              onActivate={(sourceId) => dispatch({ type: 'activateSource', sourceId })}
              onAppend={(sourceId) =>
                dispatch({ type: 'appendClip', sourceId, clipId: crypto.randomUUID() })
              }
              onRemove={removeSource}
            />
          </div>

          <div className="editor-preview">
            <VideoPreview
              videoRef={player.videoRef}
              hasClips={clips.length > 0}
              playing={player.playing}
              playhead={player.playhead}
              total={total}
              error={player.error}
              onToggle={player.toggle}
            />
          </div>

          <div className="editor-info">
            {activeSource && (
              <>
                <InfoPanel info={activeSource.info} />
                <KeyframesCard source={activeSource} />
              </>
            )}
          </div>

          <section className="card editor-timeline">
            <Toolbar
              canSplit={canSplit(clips, player.playhead)}
              canDelete={selectedIndex >= 0}
              canMoveLeft={selectedIndex > 0}
              canMoveRight={selectedIndex >= 0 && selectedIndex < clips.length - 1}
              canZoomOut={zoom > 1}
              onSplit={split}
              onDelete={remove}
              onMove={(delta) => dispatch({ type: 'moveSelected', delta })}
              onZoomIn={() => setZoom((z) => Math.min(z * ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))}
              onFit={() => setZoom(1)}
            />
            <Timeline
              clips={clips}
              sources={sources}
              playhead={player.playhead}
              total={total}
              zoom={zoom}
              selectedClipId={selectedClipId}
              onSeek={player.seek}
              onSelect={(clipId) => dispatch({ type: 'selectClip', clipId })}
            />
          </section>
        </div>
      )}
    </div>
  )
}
