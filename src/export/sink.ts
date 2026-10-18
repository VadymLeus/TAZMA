// src/export/sink.ts
import { BufferTarget, StreamTarget } from 'mediabunny'
import type { Target } from 'mediabunny'

const DIRECTORY = 'tazma-export'
const CHUNK_SIZE = 8 * 1024 * 1024

// Where an export writes its file. The browser's private file storage keeps
// the file on disk while it is built, so the length of the video is not
// limited by memory; without it the file is collected in memory.
export interface ResultSink {
  target: Target
  onDisk: boolean
  // The finished file; call after the output is finalized.
  finish(mimeType: string): Promise<Blob>
  // Removes what was written.
  discard(): Promise<void>
}

async function openDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
    if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) return null
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(DIRECTORY, { create: true })
  } catch {
    return null
  }
}

// Removes the files of earlier exports.
export async function clearExportFiles(): Promise<void> {
  const directory = await openDirectory()
  if (!directory) return
  const names: string[] = []
  for await (const name of directory.keys()) names.push(name)
  for (const name of names) await directory.removeEntry(name).catch(() => {})
}

function memorySink(): ResultSink {
  const target = new BufferTarget()
  return {
    target,
    onDisk: false,
    finish: async (mimeType) => {
      const buffer = target.buffer
      if (!buffer) throw new Error('Експорт не створив файл.')
      return new Blob([buffer], { type: mimeType })
    },
    discard: async () => {},
  }
}

export async function createSink(extension: string): Promise<ResultSink> {
  const directory = await openDirectory()
  if (!directory) return memorySink()
  try {
    await clearExportFiles()
    const name = `export-${Date.now()}.${extension}`
    const handle = await directory.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    return {
      target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
      onDisk: true,
      finish: async (mimeType) => {
        const file = await handle.getFile()
        return new Blob([file], { type: mimeType })
      },
      discard: async () => {
        await directory.removeEntry(name).catch(() => {})
      },
    }
  } catch {
    return memorySink()
  }
}
