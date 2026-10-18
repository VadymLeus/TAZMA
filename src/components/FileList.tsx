// src/components/FileList.tsx
import { formatDuration } from '../media/format.ts'
import type { Source } from '../project/types.ts'
import DropZone from './DropZone.tsx'

interface ImportNotesProps {
  pending: number
  errors: string[]
}

export function ImportNotes({ pending, errors }: ImportNotesProps) {
  return (
    <>
      {pending > 0 && <p className="muted">Читаю файли: {pending}…</p>}
      {errors.map((message, index) => (
        <p key={index} className="error">
          {message}
        </p>
      ))}
    </>
  )
}

interface FileListProps extends ImportNotesProps {
  sources: Source[]
  activeSourceId: string | null
  onFiles: (files: File[]) => void
  onActivate: (sourceId: string) => void
  onAppend: (sourceId: string) => void
  onRemove: (sourceId: string) => void
}

export default function FileList({
  sources,
  activeSourceId,
  pending,
  errors,
  onFiles,
  onActivate,
  onAppend,
  onRemove,
}: FileListProps) {
  return (
    <section className="card">
      <h2>Файли</h2>
      <ul className="files">
        {sources.map((source) => {
          const { info } = source
          const size = info.video
            ? `${info.video.width}×${info.video.height}`
            : 'без відео'
          return (
            <li
              key={source.id}
              className={source.id === activeSourceId ? 'file file-active' : 'file'}
            >
              <button
                type="button"
                className="file-main"
                onClick={() => onActivate(source.id)}
              >
                <span className="file-title" title={info.fileName}>
                  {info.fileName}
                </span>
                <span className="file-meta">
                  {formatDuration(info.duration)} · {size}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-small"
                title="Додати на таймлайн"
                aria-label="Додати на таймлайн"
                onClick={() => onAppend(source.id)}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-small"
                title="Прибрати з проєкту"
                aria-label="Прибрати з проєкту"
                onClick={() => onRemove(source.id)}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <ImportNotes pending={pending} errors={errors} />
      <DropZone onFiles={onFiles} compact />
    </section>
  )
}
