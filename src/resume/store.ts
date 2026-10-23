// src/resume/store.ts

// A file being written. Nothing of it is visible under its name until commit;
// if the page dies before that, nothing of it is left.
export interface JournalFile {
  write(chunk: Uint8Array): Promise<void>
  commit(): Promise<void>
  abort(): Promise<void>
}

// The files of one export job.
export interface JournalStore {
  create(name: string): Promise<JournalFile>
  read(name: string): Promise<Uint8Array | null>
  size(name: string): Promise<number | null>
  list(): Promise<string[]>
  remove(name: string): Promise<void>
}

export interface MemoryStore extends JournalStore {
  // What a page dying does: files being written are lost, committed ones stay.
  crash(): void
}

export function memoryStore(): MemoryStore {
  const files = new Map<string, Uint8Array>()
  const open = new Set<{ dead: boolean }>()
  return {
    async create(name) {
      const state = { dead: false }
      const parts: Uint8Array[] = []
      open.add(state)
      const alive = () => {
        if (state.dead) throw new Error('Запис перервано.')
      }
      return {
        async write(chunk) {
          alive()
          parts.push(chunk.slice())
        },
        async commit() {
          alive()
          const size = parts.reduce((sum, part) => sum + part.length, 0)
          const whole = new Uint8Array(size)
          let at = 0
          for (const part of parts) {
            whole.set(part, at)
            at += part.length
          }
          files.set(name, whole)
          open.delete(state)
        },
        async abort() {
          state.dead = true
          open.delete(state)
        },
      }
    },
    async read(name) {
      return files.get(name) ?? null
    },
    async size(name) {
      return files.get(name)?.length ?? null
    },
    async list() {
      return [...files.keys()]
    },
    async remove(name) {
      files.delete(name)
    },
    crash() {
      for (const state of open) state.dead = true
      open.clear()
    },
  }
}

// Files in a directory of the browser's private storage. A file is written
// through a writable stream, which the browser swaps in for the old file only
// when it is closed, so a file is either whole or not there.
export function opfsStore(directory: FileSystemDirectoryHandle): JournalStore {
  return {
    async create(name) {
      const handle = await directory.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      return {
        write: (chunk) => writable.write(chunk as Uint8Array<ArrayBuffer>),
        commit: () => writable.close(),
        abort: () => writable.abort(),
      }
    },
    async read(name) {
      try {
        const handle = await directory.getFileHandle(name)
        return new Uint8Array(await (await handle.getFile()).arrayBuffer())
      } catch {
        return null
      }
    },
    async size(name) {
      try {
        const handle = await directory.getFileHandle(name)
        return (await handle.getFile()).size
      } catch {
        return null
      }
    },
    async list() {
      const names: string[] = []
      for await (const name of directory.keys()) names.push(name)
      return names
    },
    async remove(name) {
      await directory.removeEntry(name).catch(() => {})
    },
  }
}

const ROOT = 'tazma-journal'

async function root(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
    if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) return null
    const top = await navigator.storage.getDirectory()
    return await top.getDirectoryHandle(ROOT, { create })
  } catch {
    return null
  }
}

// The store of a job in the private storage; null where there is none.
export async function openJobStore(job: string, create = true): Promise<JournalStore | null> {
  const top = await root(create)
  if (!top) return null
  try {
    return opfsStore(await top.getDirectoryHandle(job, { create }))
  } catch {
    return null
  }
}

// The jobs the private storage holds, finished or not.
export async function listJobs(): Promise<string[]> {
  const top = await root(false)
  if (!top) return []
  const jobs: string[] = []
  for await (const [name, handle] of top.entries()) {
    if (handle.kind === 'directory') jobs.push(name)
  }
  return jobs
}

export async function removeJob(job: string): Promise<void> {
  const top = await root(false)
  await top?.removeEntry(job, { recursive: true }).catch(() => {})
}
