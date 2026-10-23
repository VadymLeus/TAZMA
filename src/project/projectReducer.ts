// src/project/projectReducer.ts
import { clampAmount } from './effects.ts'
import {
  fitTexts,
  newText,
  removeText,
  updateText,
} from './texts.ts'
import type { TextPatch } from './texts.ts'
import {
  moveClip,
  removeClip,
  removeSourceClips,
  splitAt,
  timelineDuration,
} from './timeline.ts'
import type { Clip, Effect, ProjectState, Source } from './types.ts'

export type ProjectAction =
  | { type: 'addSource'; source: Source; clipId: string }
  | { type: 'appendClip'; sourceId: string; clipId: string }
  | { type: 'removeSource'; sourceId: string }
  | { type: 'activateSource'; sourceId: string }
  | { type: 'selectClip'; clipId: string | null }
  | { type: 'split'; time: number; newId: string }
  | { type: 'deleteSelected' }
  | { type: 'moveSelected'; delta: -1 | 1 }
  | { type: 'setEffect'; clipId: string; effect: Effect | null }
  | { type: 'addText'; textId: string; time: number }
  | { type: 'selectText'; textId: string | null }
  | { type: 'updateText'; textId: string; patch: TextPatch }

export const initialProject: ProjectState = {
  sources: [],
  clips: [],
  texts: [],
  selectedClipId: null,
  selectedTextId: null,
  activeSourceId: null,
}

function wholeClip(source: Source, clipId: string): Clip {
  return { id: clipId, sourceId: source.id, start: 0, end: source.info.duration }
}

// Captions follow the timeline length; a selected caption that was dropped is deselected.
function withFittedTexts(state: ProjectState, clips: Clip[]): ProjectState {
  const texts = fitTexts(state.texts, timelineDuration(clips))
  const selectedTextId = texts.some((t) => t.id === state.selectedTextId)
    ? state.selectedTextId
    : null
  return { ...state, clips, texts, selectedTextId }
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
        selectedTextId: null,
        activeSourceId: source.id,
      }
    }

    case 'removeSource': {
      const clips = removeSourceClips(state.clips, action.sourceId)
      const sources = state.sources.filter((s) => s.id !== action.sourceId)
      return {
        ...withFittedTexts(state, clips),
        sources,
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
        selectedTextId: null,
        activeSourceId: clip ? clip.sourceId : state.activeSourceId,
      }
    }

    case 'split': {
      const result = splitAt(state.clips, action.time, action.newId)
      if (!result) return state
      return {
        ...state,
        clips: result.clips,
        selectedClipId: result.rightId,
        selectedTextId: null,
      }
    }

    case 'deleteSelected':
      if (state.selectedTextId) {
        return {
          ...state,
          texts: removeText(state.texts, state.selectedTextId),
          selectedTextId: null,
        }
      }
      if (!state.selectedClipId) return state
      return {
        ...withFittedTexts(state, removeClip(state.clips, state.selectedClipId)),
        selectedClipId: null,
      }

    case 'moveSelected':
      if (!state.selectedClipId) return state
      return {
        ...state,
        clips: moveClip(state.clips, state.selectedClipId, action.delta),
      }

    case 'setEffect': {
      if (!state.clips.some((c) => c.id === action.clipId)) return state
      return {
        ...state,
        clips: state.clips.map((clip) => {
          if (clip.id !== action.clipId) return clip
          const { effect: _previous, ...rest } = clip
          if (!action.effect) return rest
          const amount = clampAmount(action.effect.amount)
          return { ...rest, effect: { ...action.effect, amount } }
        }),
      }
    }

    case 'addText': {
      const text = newText(action.textId, action.time, timelineDuration(state.clips))
      if (!text) return state
      return {
        ...state,
        texts: [...state.texts, text],
        selectedTextId: text.id,
        selectedClipId: null,
      }
    }

    case 'selectText': {
      const text = state.texts.find((t) => t.id === action.textId)
      return {
        ...state,
        selectedTextId: text ? text.id : null,
        selectedClipId: text ? null : state.selectedClipId,
      }
    }

    case 'updateText':
      return {
        ...state,
        texts: updateText(
          state.texts,
          action.textId,
          action.patch,
          timelineDuration(state.clips),
        ),
      }
  }
}
