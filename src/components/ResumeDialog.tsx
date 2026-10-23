// src/components/ResumeDialog.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { defaultSettings, exportFileName } from '../export/settings.ts'
import { estimateRemaining } from '../export/stats.ts'
import { useExportJob } from '../export/useExportJob.ts'
import { formatBytes } from '../media/format.ts'
import { probeFile } from '../media/probe.ts'
import { prepareContinue } from '../resume/continueJob.ts'
import type { JobSummary } from '../resume/jobs.ts'
import { progressLine, remainderLine } from '../resume/jobText.ts'
import { matchSources } from '../resume/restore.ts'
import DropZone from './DropZone.tsx'
import { ResultInfo, progressText } from './ExportResult.tsx'

interface ResumeDialogProps {
  open: boolean
  jobs: JobSummary[]
  // Files already open in the editor: they count as picked.
  files: File[]
  onClose: () => void
  onRemove: (job: string) => Promise<void>
  onRemoveAll: () => Promise<void>
  // The list may have changed: an export ended, whatever came of it.
  onChanged: () => void
}

const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`

const dateText = (time: number) =>
  time > 0 ? new Date(time).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Дата невідома'

export default function ResumeDialog({
  open,
  jobs,
  files,
  onClose,
  onRemove,
  onRemoveAll,
  onChanged,
}: ResumeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [picked, setPicked] = useState<File[]>([])
  const [confirm, setConfirm] = useState<string | null>(null)
  const [preparing, setPreparing] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ job: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const job = useExportJob()
  const { state } = job
  const running = state.phase === 'running'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    if (!open) {
      setPicked([])
      setConfirm(null)
      setNotice(null)
    }
  }, [open])

  // An export that has ended has changed the list of journals: a finished
  // one removed its own.
  const phase = useRef(state.phase)
  useEffect(() => {
    const before = phase.current
    phase.current = state.phase
    if (before === 'running' && state.phase !== 'running') onChanged()
  }, [state.phase, onChanged])

  const available = useMemo(() => [...files, ...picked], [files, picked])

  function add(added: File[]) {
    setPicked((current) => {
      const known = new Set(current.map(fileKey))
      return [...current, ...added.filter((file) => !known.has(fileKey(file)))]
    })
    setNotice(null)
  }

  async function resume(item: JobSummary) {
    setNotice(null)
    setPreparing(item.job)
    try {
      const prepared = await prepareContinue(
        item.job,
        available,
        { ...defaultSettings, recordMemory: false },
        { probe: probeFile },
      )
      if (!prepared.ok) {
        setNotice({ job: item.job, message: prepared.message })
        return
      }
      setPreparing(null)
      void job.start(prepared.project, prepared.settings, { resumeJob: item.job })
    } catch (error) {
      setNotice({ job: item.job, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setPreparing(null)
    }
  }

  async function remove(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  function close() {
    if (running || preparing !== null) return
    job.reset()
    onClose()
  }

  const progress = state.phase === 'running' ? state.progress : null
  const remaining =
    state.phase === 'running' && progress && (progress.phase ?? 'video') === 'video'
      ? estimateRemaining(progress.time, progress.total, performance.now() - state.startedAt)
      : null
  const removable = jobs.filter((item) => !item.active)

  return (
    <dialog
      ref={dialogRef}
      className="export-dialog resume-dialog"
      aria-labelledby="resume-title"
      onCancel={(event: { preventDefault(): void }) => {
        event.preventDefault()
        close()
      }}
    >
      <h2 id="resume-title">Продовження експорту</h2>

      {open && state.phase === 'idle' && (
        <>
          <p className="muted export-summary">
            Журнал зберігається у приватному сховищі браузера. Щоб продовжити, потрібні ті самі
            файли, з яких експорт було розпочато: оберіть їх нижче.
          </p>
          <DropZone compact onFiles={add} />
          {picked.length > 0 && (
            <p className="muted export-note" data-testid="picked">
              Обрано файлів: {picked.length}
            </p>
          )}

          {jobs.length === 0 ? (
            <p className="muted resume-empty">Незавершених експортів немає.</p>
          ) : (
            <ul className="resume-jobs">
              {jobs.map((item) => (
                <JobCard
                  key={item.job}
                  item={item}
                  available={available}
                  preparing={preparing === item.job}
                  disabled={preparing !== null || busy}
                  confirming={confirm === item.job}
                  notice={notice?.job === item.job ? notice.message : null}
                  onResume={() => void resume(item)}
                  onAskRemove={() => setConfirm(item.job)}
                  onCancelRemove={() => setConfirm(null)}
                  onRemove={() => void remove(() => onRemove(item.job))}
                />
              ))}
            </ul>
          )}

          <div className="dialog-actions">
            {confirm === '*' ? (
              <>
                <span className="resume-confirm">
                  Видалити {removable.length} журн. без можливості відновлення?
                </span>
                <button type="button" className="btn" onClick={() => setConfirm(null)}>
                  Ні
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void remove(onRemoveAll)}
                >
                  Так, видалити всі
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={removable.length === 0 || preparing !== null || busy}
                  onClick={() => setConfirm('*')}
                >
                  Видалити всі
                </button>
                <button type="button" className="btn" onClick={close}>
                  Закрити
                </button>
              </>
            )}
          </div>
        </>
      )}

      {open && running && (
        <>
          <progress
            className="export-progress"
            max={progress?.total || 1}
            value={progress?.time ?? 0}
          />
          <p className="export-status" role="status">
            {progress ? progressText(progress, remaining) : 'Перевіряю журнал і готую кодувальники…'}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={job.cancel}>
              Скасувати і видалити журнал
            </button>
          </div>
        </>
      )}

      {open && state.phase === 'done' && (
        <>
          <video className="export-video" src={state.url} controls />
          <ResultInfo result={state.result} />
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={job.reset}>
              До списку
            </button>
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
            <a
              className="btn btn-primary"
              href={state.url}
              download={exportFileName(state.result.settings.container)}
            >
              Зберегти
            </a>
          </div>
        </>
      )}

      {open && state.phase === 'error' && (
        <>
          <p className="error" role="alert">
            Не вдалося продовжити: {state.message}
          </p>
          <p className="muted export-note">
            Журнал не видалено: можна спробувати ще раз або видалити його в списку.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
            <button type="button" className="btn" onClick={job.reset}>
              До списку
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}

interface JobCardProps {
  item: JobSummary
  available: File[]
  preparing: boolean
  disabled: boolean
  confirming: boolean
  notice: string | null
  onResume: () => void
  onAskRemove: () => void
  onCancelRemove: () => void
  onRemove: () => void
}

function JobCard({
  item,
  available,
  preparing,
  disabled,
  confirming,
  notice,
  onResume,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: JobCardProps) {
  const { missing } = useMemo(() => matchSources(item.sources, available), [item.sources, available])
  const lacking = new Map(missing.map((entry) => [entry.ref.id, entry]))
  const canResume = item.usable && !item.active && missing.length === 0

  return (
    <li className="resume-job" data-job={item.job}>
      <div className="resume-head">
        <strong>{dateText(item.updated)}</strong>
      </div>
      {item.usable ? (
        <>
          <p>{progressLine(item)}</p>
          <p className="muted">{remainderLine(item)}</p>
          <ul className="resume-sources">
            {item.sources.map((ref) => {
              const entry = lacking.get(ref.id)
              return (
                <li key={ref.id} className={entry ? 'resume-missing' : 'resume-found'}>
                  <span aria-hidden="true">{entry ? '✗' : '✓'}</span> {ref.name}{' '}
                  <span className="muted">({formatBytes(ref.size)})</span>
                  {entry?.sameName && <span className="muted"> — файл з такою назвою є, але це інша версія</span>}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {item.active && (
        <p className="muted">Цей журнал зараз використовує експорт у цій або іншій вкладці.</p>
      )}
      {item.problems.length > 0 && (
        <ul className="resume-problems muted">
          {item.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      {!item.active && (
        <div className="resume-actions">
          {confirming ? (
            <>
              <span className="resume-confirm">Видалити журнал?</span>
              <button type="button" className="btn btn-small" onClick={onCancelRemove}>
                Ні
              </button>
              <button type="button" className="btn btn-small btn-danger" disabled={disabled} onClick={onRemove}>
                Так, видалити
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-small" disabled={disabled} onClick={onAskRemove}>
                Видалити
              </button>
              {item.usable && (
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  disabled={!canResume || disabled}
                  title={canResume ? undefined : 'Оберіть файли, яких бракує'}
                  onClick={onResume}
                >
                  {preparing ? 'Відкриваю файли…' : 'Продовжити'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}
