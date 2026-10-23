// src/project/types.ts
import type { MediaInfo } from '../media/probe.ts'

export interface Source {
  id: string
  file: File
  url: string
  info: MediaInfo
}

export type EffectKind = 'grayscale'

// amount is the strength from 0 to 1.
export interface Effect {
  kind: EffectKind
  amount: number
}

// A piece of a source file; start and end are seconds inside that file.
export interface Clip {
  id: string
  sourceId: string
  start: number
  end: number
  effect?: Effect
}

// A caption on the timeline: start and end are timeline seconds; x, y are the
// centre as a fraction of the frame; size is the text height as a fraction of
// the frame height.
export interface TextItem {
  id: string
  text: string
  start: number
  end: number
  x: number
  y: number
  size: number
  color: string
}

export interface ProjectState {
  sources: Source[]
  clips: Clip[]
  texts: TextItem[]
  selectedClipId: string | null
  selectedTextId: string | null
  activeSourceId: string | null
}
