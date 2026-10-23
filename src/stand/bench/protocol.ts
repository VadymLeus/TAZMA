// src/stand/bench/protocol.ts
import type { StageTimes } from '../../export/stageTimes.ts'
import type { ExportSettings } from '../../export/types.ts'
import type { WireError } from '../../export/worker/protocol.ts'

// The parts of the export pipeline that are timed one by one, each alone:
// reading the packets of the file, decoding, copying packets into an output
// (thrown away or written to a file), encoding frames of a canvas, and the
// start of encoder sessions (alone and while the decoder is working).
export const BENCH_KINDS = [
  'read',
  'decode',
  'copy-null',
  'copy-file',
  'encode',
  'session',
  'session-busy',
] as const
export type BenchKind = (typeof BENCH_KINDS)[number]

export const isBenchKind = (value: string): value is BenchKind => (BENCH_KINDS as readonly string[]).includes(value)

export interface BenchSpec {
  kind: BenchKind
  file: File
  // Seconds of the file taken from its start; 0 takes all of it.
  seconds: number
  // What the encoders are asked for, as in an export.
  videoCodec: ExportSettings['videoCodec']
  quality: ExportSettings['quality']
}

// What one timed run gives back.
export interface BenchOutput {
  // Frames or packets that went through, the bytes of packets among them, and
  // the seconds of video they cover.
  frames: number
  bytes: number
  duration: number
  width: number
  height: number
  // The whole run, in milliseconds, and where it went.
  elapsedMs: number
  stages: StageTimes
  notes: string[]
}

export type ToBench = { type: 'start'; spec: BenchSpec } | { type: 'abort' }

export type FromBench =
  | { type: 'ready' }
  | { type: 'done'; output: BenchOutput }
  | { type: 'error'; error: WireError }
