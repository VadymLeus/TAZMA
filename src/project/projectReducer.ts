// src/project/projectReducer.ts
import {
  moveClip,
  removeClip,
  removeSourceClips,
  splitAt,
} from './timeline.ts'
import type { Clip, ProjectState, Source } from './types.ts'

export type ProjectAction =
  | { type: 'addSource'; source: Source; clipId: string }
  | { type: 'appendClip'; sourceId: string; clipId: string }
  | { type: 'removeSource'; sourceId: string }
  | { type: 'activateSource'; sourceId: string }
  | { type: 'selectClip'; clipId: string | null }
  | { type: 'split'; time: number; newId: string }
  | { type: 'deleteSelected' }
  | { type: 'moveSelected'; delta: -1 | 1 }

export const initialProject: ProjectState = {
  sources: [],
  clips: [],
  selectedClipId: null,
  activeSourceId: null,
}

function wholeClip(source: Source, clipId: string): Clip {
  return { id: clipId, sourceId: source.id, start: 0, end: source.info.duration }
}

export function projectReducer(
  state: ProjectState,
  action: ProjectAction,
): ProjectState {
  switch (action.type) {
    case 'addSource': {
      // Only the first file is shown and selected; later imports just join the list.
      const first = state.sources.length === 0
      return {
        ...state,
        sources: [...state.sources, action.source],
        clips: [...state.clips, wholeClip(action.source, action.clipId)],
        selectedClipId: first ? action.clipId : state.selectedClipId,
        activeSourceId: first ? action.source.id : state.activeSourceId,
      }
    }

    case 'appendClip': {
      const source = state.sources.find((s) => s.id === action.sourceId)
      if (!source) return state
      return {
        ...state,
        clips: [...state.clips, wholeClip(source, action.clipId)],
        selectedClipId: action.clipId,
        activeSourceId: source.id,
      }
    }

    case 'removeSource': {
      const clips = removeSourceClips(state.clips, action.sourceId)
      const sources = state.sources.filter((s) => s.id !== action.sourceId)
      return {
        sources,
        clips,
        selectedClipId: clips.some((c) => c.id === state.selectedClipId)
          ? state.selectedClipId
          : null,
        activeSourceId:
          state.activeSourceId === action.sourceId
            ? (sources[0]?.id ?? null)
            : state.activeSourceId,
      }
    }

    case 'activateSource':
      return { ...state, activeSourceId: action.sourceId }

    case 'selectClip': {
      const clip = state.clips.find((c) => c.id === action.clipId)
      return {
        ...state,
        selectedClipId: clip ? clip.id : null,
        activeSourceId: clip ? clip.sourceId : state.activeSourceId,
      }
    }

    case 'split': {
      const result = splitAt(state.clips, action.time, action.newId)
      if (!result) return state
      return { ...state, clips: result.clips, selectedClipId: result.rightId }
    }

    case 'deleteSelected':
      if (!state.selectedClipId) return state
      return {
        ...state,
        clips: removeClip(state.clips, state.selectedClipId),
        selectedClipId: null,
      }

    case 'moveSelected':
      if (!state.selectedClipId) return state
      return {
        ...state,
        clips: moveClip(state.clips, state.selectedClipId, action.delta),
      }
  }
}
