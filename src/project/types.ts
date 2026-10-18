// src/project/types.ts
import type { MediaInfo } from '../media/probe.ts'

export interface Source {
  id: string
  file: File
  url: string
  info: MediaInfo
}

// A piece of a source file; start and end are seconds inside that file.
export interface Clip {
  id: string
  sourceId: string
  start: number
  end: number
}

export interface ProjectState {
  sources: Source[]
  clips: Clip[]
  selectedClipId: string | null
  activeSourceId: string | null
}
