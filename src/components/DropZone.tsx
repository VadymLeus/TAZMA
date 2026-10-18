import { useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'

interface DropZoneProps {
  onFile: (file: File) => void
  /** Smaller variant shown once a file is already open. */
  compact?: boolean
}

export default function DropZone({ onFile, compact = false }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    // Without this the browser does not allow dropping.
    event.preventDefault()
    setDragging(true)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onFile(file)
    // Allow choosing the same file again.
    event.target.value = ''
  }

  const className = [
    'dropzone',
    compact ? 'dropzone-compact' : '',
    dragging ? 'dropzone-active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <label
      className={className}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept="video/*,.mkv,.webm,.mp4,.m4v,.mov"
        onChange={handleChange}
      />
      {compact ? (
        <span>Відкрити інший файл</span>
      ) : (
        <>
          <strong>Перетягніть відеофайл сюди</strong>
          <span>або натисніть, щоб вибрати його на комп'ютері</span>
          <span className="hint">MP4, WebM, MKV, MOV</span>
        </>
      )}
    </label>
  )
}
