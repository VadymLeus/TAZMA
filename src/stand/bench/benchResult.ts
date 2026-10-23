// src/stand/bench/benchResult.ts
import type { ExportSettings } from '../../export/types.ts'
import type { StandResult } from '../record.ts'
import type { BenchKind, BenchOutput } from './protocol.ts'

// A timed run as the stand's table sees it: the same shape as an export, with
// no file, so that it is recorded and summarized like one.
export function benchResult(kind: BenchKind, output: BenchOutput, settings: ExportSettings): StandResult {
  return {
    blob: new Blob([]),
    mimeType: '',
    bytes: output.bytes,
    elapsedMs: output.elapsedMs,
    frames: output.frames,
    width: output.width,
    height: output.height,
    duration: output.duration,
    hasAudio: false,
    notes: output.notes,
    file: null,
    thread: 'worker',
    settings,
    stats: {
      mode: settings.mode,
      framesCopied: 0,
      framesRecoded: 0,
      copiedSeconds: 0,
      recodedSeconds: 0,
      runs: 0,
      fallbackGops: 0,
      rewrittenPackets: 0,
    },
    stages: output.stages,
    bench: kind,
    release: async () => {},
  }
}
