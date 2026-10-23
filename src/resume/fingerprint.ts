// src/resume/fingerprint.ts
import type { ExportProject, ExportSettings } from '../export/types.ts'
import { sourceRefs } from './manifest.ts'

// Bumped when the way the journal cuts or encodes the output changes, so a
// journal made by an older way is not continued by a newer one.
export const ENGINE = 1

// The settings that change the output file. The frame limit, the thread and
// the memory readings do not.
export const OUTPUT_KEYS = [
  'mode',
  'container',
  'videoCodec',
  'audioCodec',
  'quality',
  'height',
  'ignoreColor',
] as const

function outputSettings(settings: ExportSettings): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of OUTPUT_KEYS) picked[key] = settings[key]
  return picked
}

// What an export depends on, as text: the clips and captions, the identity of
// each source file, and the settings that shape the output.
export function describeExport(project: ExportProject, settings: ExportSettings): string {
  return JSON.stringify({
    engine: ENGINE,
    clips: project.clips.map((clip) => ({
      id: clip.id,
      sourceId: clip.sourceId,
      start: clip.start,
      end: clip.end,
      effect: clip.effect ?? null,
    })),
    texts: project.texts,
    sources: sourceRefs(project),
    settings: outputSettings(settings),
  })
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function fingerprintOf(project: ExportProject, settings: ExportSettings): Promise<string> {
  return sha256(describeExport(project, settings))
}
