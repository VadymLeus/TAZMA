// src/components/DropZone.tsx
import { useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  compact?: boolean
}

export default function DropZone({ onFiles, compact = false }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    // Without this the browser does not allow dropping.
    event.preventDefault()
    setDragging(true)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) onFiles(files)
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
        multiple
        accept="video/*,.mkv,.webm,.mp4,.m4v,.mov"
        onChange={handleChange}
      />
      {compact ? (
        <span>Додати файли</span>
      ) : (
        <>
          <strong>Перетягніть відеофайли сюди</strong>
          <span>або натисніть, щоб вибрати їх на комп'ютері</span>
          <span className="hint">MP4, WebM, MKV, MOV</span>
        </>
      )}
    </label>
  )
}
