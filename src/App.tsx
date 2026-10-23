// src/App.tsx
import { useEffect, useReducer, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import DropZone from './components/DropZone.tsx'
import ExportPage from './components/ExportPage.tsx'
import FileList, { ImportNotes } from './components/FileList.tsx'
import InfoPanel from './components/InfoPanel.tsx'
import Inspector from './components/Inspector.tsx'
import KeyframesCard from './components/KeyframesCard.tsx'
import PageBar from './components/PageBar.tsx'
import type { ExportBusy, PageId } from './components/PageBar.tsx'
import ResumeDialog from './components/ResumeDialog.tsx'
import SideTabs from './components/SideTabs.tsx'
import Timeline from './components/Timeline.tsx'
import Toolbar from './components/Toolbar.tsx'
import VideoPreview from './components/VideoPreview.tsx'
import { useSplitter } from './components/useSplitter.ts'
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
import StandApp from './stand/StandApp.tsx'

const ZOOM_STEP = 1.5
const MAX_ZOOM = 100

type SideTab = 'clip' | 'file' | 'frames'

const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: 'clip', label: 'Кліп' },
  { id: 'file', label: 'Файл' },
  { id: 'frames', label: 'Ключові кадри' },
]

interface AppProps {
  initialPage?: PageId
}

export default function App({ initialPage = 'editor' }: AppProps) {
  const [project, dispatch] = useReducer(projectReducer, initialProject)
  const { sources, clips, texts, selectedClipId, selectedTextId, activeSourceId } =
    project
  const { importFiles, pending, errors, status } = useImport(dispatch)
  const player = usePlayback(clips, sources)
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState<PageId>(initialPage)
  // The stand is built on first use and then kept, so a series goes on while
  // another page is open.
  const [standSeen, setStandSeen] = useState(initialPage === 'stand')
  const [exportBusy, setExportBusy] = useState<ExportBusy>({ phase: 'idle', percent: 0 })
  const [resumeOpen, setResumeOpen] = useState(false)
  const [sideTab, setSideTab] = useState<SideTab>('clip')
  const unfinished = useUnfinished()
  const waiting = unfinished.jobs.filter((item) => !item.active).length
  const editorRef = useRef<HTMLDivElement>(null)
  const splitter = useSplitter(editorRef)

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

  const actions = useRef({ split, addText, remove, toggle: player.toggle, page })
  useEffect(() => {
    actions.current = { split, addText, remove, toggle: player.toggle, page }
  })

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // The keys belong to the editor; on the other pages they do nothing.
      if (actions.current.page !== 'editor') return
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

  // A new text and a split change the selection too; show its properties.
  useEffect(() => {
    if (selectedClipId !== null || selectedTextId !== null) setSideTab('clip')
  }, [selectedClipId, selectedTextId])

  function goTo(next: PageId) {
    if (next === page) return
    if (player.playing) player.toggle()
    if (page === 'export') void unfinished.refresh()
    if (next === 'stand') setStandSeen(true)
    setPage(next)
  }

  function openResume() {
    if (player.playing) player.toggle()
    void unfinished.refresh()
    setResumeOpen(true)
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

  const hint = (text: string) => <p className="muted panel-hint">{text}</p>

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">TAZMA</span>
        {total > 0 && page !== 'stand' && (
          <span className="topbar-info">
            {clips.length} кл. · {formatSpan(total)} · {frame.width}×{frame.height}
          </span>
        )}
        <div className="topbar-actions">
          {waiting > 0 && (
            <button
              type="button"
              className="btn btn-small"
              onClick={openResume}
              title="Експорти, що не дійшли до кінця, лишили журнали в сховищі браузера"
            >
              Продовжити експорт ({waiting})
            </button>
          )}
        </div>
      </header>

      <main className="pages">
        <section className="page" hidden={page !== 'editor'} aria-label="Редактор">
          {sources.length === 0 ? (
            <div className="page-empty">
              <DropZone onFiles={importFiles} />
              <ImportNotes pending={pending} errors={errors} status={status} />
            </div>
          ) : (
            <div
              className="editor"
              ref={editorRef}
              style={{ '--panel-h': splitter.size } as CSSProperties}
            >
              <div className="panel editor-files">
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

              <div className="panel editor-preview">
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

              <div className="panel editor-info">
                <SideTabs tabs={SIDE_TABS} value={sideTab} onChange={setSideTab} />
                <div className="side-body">
                  {sideTab === 'clip' && (
                    <>
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
                      {!selectedClip &&
                        !selectedText &&
                        hint('Виділіть кліп або напис на таймлайні, щоб змінити його властивості.')}
                    </>
                  )}
                  {sideTab === 'file' &&
                    (activeSource
                      ? <InfoPanel info={activeSource.info} />
                      : hint('Виберіть файл у медіатеці.'))}
                  {sideTab === 'frames' &&
                    (activeSource
                      ? <KeyframesCard source={activeSource} />
                      : hint('Виберіть файл у медіатеці.'))}
                </div>
              </div>

              <div
                className="splitter"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Висота таймлайна"
                tabIndex={0}
                title="Потягніть, щоб змінити висоту таймлайна"
                {...splitter.separatorProps}
              />

              <section className="panel editor-timeline">
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
                  onSelect={(clipId) => {
                    dispatch({ type: 'selectClip', clipId })
                    if (clipId !== null) setSideTab('clip')
                  }}
                  onSelectText={(textId) => {
                    dispatch({ type: 'selectText', textId })
                    setSideTab('clip')
                  }}
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
        </section>

        <section className="page" hidden={page !== 'export'} aria-label="Експорт">
          <ExportPage
            active={page === 'export'}
            project={{ clips, texts, sources }}
            frame={frame}
            total={total}
            onBusy={setExportBusy}
            onSettled={unfinished.refresh}
            onOpenEditor={() => goTo('editor')}
          />
        </section>

        {standSeen && (
          <section className="page" hidden={page !== 'stand'} aria-label="Стенд випробувань">
            <StandApp embedded editorLoaded={sources.length > 0} />
          </section>
        )}
      </main>

      <PageBar page={page} exportBusy={exportBusy} onChange={goTo} />

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
