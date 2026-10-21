// src/App.tsx
import { useEffect, useReducer, useRef, useState } from 'react'
import DropZone from './components/DropZone.tsx'
import ExportDialog from './components/ExportDialog.tsx'
import FileList, { ImportNotes } from './components/FileList.tsx'
import InfoPanel from './components/InfoPanel.tsx'
import Inspector from './components/Inspector.tsx'
import KeyframesCard from './components/KeyframesCard.tsx'
import ResumeDialog from './components/ResumeDialog.tsx'
import Timeline from './components/Timeline.tsx'
import Toolbar from './components/Toolbar.tsx'
import VideoPreview from './components/VideoPreview.tsx'
import { formatSpan } from './media/format.ts'
import { effectFilter } from './project/effects.ts'
import { frameSize } from './project/frame.ts'
import { initialProject, projectReducer } from './project/projectReducer.ts'
import { rangesLength, recomputeRanges } from './project/recompute.ts'
import { MIN_TEXT, textsAt } from './project/texts.ts'
import { canSplit, locate, timelineDuration } from './project/timeline.ts'
import { useImport } from './project/useImport.ts'
import { usePlayback } from './project/usePlayback.ts'
import { useUnfinished } from './resume/useUnfinished.ts'

const ZOOM_STEP = 1.5
const MAX_ZOOM = 100

export default function App() {
  const [project, dispatch] = useReducer(projectReducer, initialProject)
  const { sources, clips, texts, selectedClipId, selectedTextId, activeSourceId } =
    project
  const { importFiles, pending, errors, status } = useImport(dispatch)
  const player = usePlayback(clips, sources)
  const [zoom, setZoom] = useState(1)
  const [exportOpen, setExportOpen] = useState(false)
  const [resumeOpen, setResumeOpen] = useState(false)
  const unfinished = useUnfinished()
  const waiting = unfinished.jobs.filter((item) => !item.active).length

  const total = timelineDuration(clips)
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? null
  const selectedIndex = clips.findIndex((c) => c.id === selectedClipId)
  const selectedClip = clips[selectedIndex] ?? null
  const selectedText = texts.find((t) => t.id === selectedTextId) ?? null

  const frame = frameSize(clips, sources)
  const location = locate(clips, player.playhead)
  const filter = effectFilter(location ? clips[location.index].effect : undefined)
  const activeTexts = textsAt(texts, player.playhead)
  const recompute = recomputeRanges(clips, texts)
  const recomputeTotal = rangesLength(recompute)

  const split = () =>
    dispatch({ type: 'split', time: player.playhead, newId: crypto.randomUUID() })
  const addText = () =>
    dispatch({ type: 'addText', textId: crypto.randomUUID(), time: player.playhead })
  const remove = () => dispatch({ type: 'deleteSelected' })

  const actions = useRef({ split, addText, remove, toggle: player.toggle })
  useEffect(() => {
    actions.current = { split, addText, remove, toggle: player.toggle }
  })

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest('dialog')) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (event.key === ' ' && tag !== 'BUTTON') {
        event.preventDefault()
        actions.current.toggle()
      } else if (event.key === 's' || event.key === 'S') {
        actions.current.split()
      } else if (event.key === 't' || event.key === 'T') {
        actions.current.addText()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        actions.current.remove()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  function openExport() {
    if (player.playing) player.toggle()
    setExportOpen(true)
  }

  function openResume() {
    if (player.playing) player.toggle()
    void unfinished.refresh()
    setResumeOpen(true)
  }

  function closeExport() {
    setExportOpen(false)
    void unfinished.refresh()
  }

  function closeResume() {
    setResumeOpen(false)
    void unfinished.refresh()
  }

  function removeSource(sourceId: string) {
    const source = sources.find((s) => s.id === sourceId)
    if (source) URL.revokeObjectURL(source.url)
    dispatch({ type: 'removeSource', sourceId })
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">TAZMA</span>
        <span className="stage">Етап 7 · відновлення</span>
        <div className="header-actions">
          {waiting > 0 && (
            <button
              type="button"
              className="btn header-action"
              onClick={openResume}
              title="Експорти, що не дійшли до кінця, лишили журнали в сховищі браузера"
            >
              Продовжити експорт ({waiting})
            </button>
          )}
          {sources.length > 0 && (
            <button
              type="button"
              className="btn btn-primary header-action"
              disabled={total <= 0}
              onClick={openExport}
              title="Зберегти проєкт у файл"
            >
              Експорт
            </button>
          )}
        </div>
      </header>

      {sources.length === 0 ? (
        <>
          <DropZone onFiles={importFiles} />
          <ImportNotes pending={pending} errors={errors} status={status} />
        </>
      ) : (
        <div className="editor">
          <div className="editor-files">
            <FileList
              sources={sources}
              activeSourceId={activeSourceId}
              pending={pending}
              errors={errors}
              status={status}
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
              frame={frame}
              filter={filter}
              texts={activeTexts}
              onToggle={player.toggle}
            />
          </div>

          <div className="editor-info">
            <Inspector
              clip={selectedClip}
              clipName={
                sources.find((s) => s.id === selectedClip?.sourceId)?.info.fileName ?? ''
              }
              text={selectedText}
              playhead={player.playhead}
              onEffect={(effect) =>
                selectedClip &&
                dispatch({ type: 'setEffect', clipId: selectedClip.id, effect })
              }
              onText={(patch) =>
                selectedText &&
                dispatch({ type: 'updateText', textId: selectedText.id, patch })
              }
            />
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
              canAddText={total >= MIN_TEXT}
              canDelete={selectedIndex >= 0 || selectedText !== null}
              canMoveLeft={selectedIndex > 0}
              canMoveRight={selectedIndex >= 0 && selectedIndex < clips.length - 1}
              canZoomOut={zoom > 1}
              onSplit={split}
              onAddText={addText}
              onDelete={remove}
              onMove={(delta) => dispatch({ type: 'moveSelected', delta })}
              onZoomIn={() => setZoom((z) => Math.min(z * ZOOM_STEP, MAX_ZOOM))}
              onZoomOut={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))}
              onFit={() => setZoom(1)}
            />
            <Timeline
              clips={clips}
              sources={sources}
              texts={texts}
              recompute={recompute}
              playhead={player.playhead}
              total={total}
              zoom={zoom}
              selectedClipId={selectedClipId}
              selectedTextId={selectedTextId}
              onSeek={player.seek}
              onSelect={(clipId) => dispatch({ type: 'selectClip', clipId })}
              onSelectText={(textId) => dispatch({ type: 'selectText', textId })}
            />
            {total > 0 && (
              <p className="recompute-note">
                <span className="swatch" aria-hidden="true" />
                {recomputeTotal > 0
                  ? `Потребує перерахунку при експорті: ${formatSpan(recomputeTotal)} з ${formatSpan(total)} (${Math.max(1, Math.round((recomputeTotal / total) * 100))} %). Решту можна копіювати.`
                  : 'Ефектів і тексту немає: при експорті все можна копіювати без перерахунку.'}
              </p>
            )}
          </section>
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        project={{ clips, texts, sources }}
        frame={frame}
        total={total}
        onClose={closeExport}
      />
      <ResumeDialog
        open={resumeOpen}
        jobs={unfinished.jobs}
        files={sources.map((source) => source.file)}
        onClose={closeResume}
        onRemove={unfinished.remove}
        onRemoveAll={unfinished.removeAll}
        onChanged={unfinished.refresh}
      />
    </div>
  )
}
