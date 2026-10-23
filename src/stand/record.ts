// src/stand/record.ts
import { peakMoment } from '../diagnostics/memoryTrace.ts'
import type { StageTimes } from '../export/stageTimes.ts'
import type { ExportResult } from '../export/types.ts'
import type { BenchKind } from './bench/protocol.ts'
import type { QualityReport } from './quality.ts'

const MIB = 1024 * 1024

// What a run with simulated cuts adds to its result: how many times it was cut,
// how many attempts it took and how long a restart took on average, from the
// cut until work was under way again.
export interface CrashFigures {
  crashes: number
  attempts: number
  // Restarts that had no readable journal and began the export again.
  fresh: number
  restartMs: number | null
}

// The fields of a record that come from the stage times of the export.
export const STAGE_FIELDS = [
  'waitMs', 'composeMs', 'encodeMs', 'firstFrameMs', 'setupMs', 'finishMs', 'firstItemMs', 'firstAddMs',
  'videoPullMs', 'audioPullMs', 'audioAddMs', 'startRunMs', 'endRunMs', 'sendMs', 'createMs', 'readMs',
  'seekMs', 'decodeMs', 'probeMs', 'scanMs', 'decodeAskMs', 'firstSampleMs',
] as const satisfies readonly (keyof StageTimes)[]
export type StageField = (typeof STAGE_FIELDS)[number]

export function stageFigures(stages: StageTimes | null | undefined): Record<StageField, number | null> {
  const out = {} as Record<StageField, number | null>
  for (const key of STAGE_FIELDS) out[key] = stages ? stages[key] : null
  return out
}

const NO_STAGES = stageFigures(null)

// bench is set when the run timed one part of the pipeline alone and not an
// export: it has no file, and its stages are the figures that matter.
export type StandResult = ExportResult & { crash?: CrashFigures; quality?: QualityReport | null; bench?: BenchKind }

// Where one run sits in its series.
export interface RunMeta {
  series: string
  condition: string
  label: string
  index: number
  round: number
  warmup: boolean
}

// What one run is written down as: flat, so that it goes into a table or CSV.
export interface RunRecord extends RunMeta, Record<StageField, number | null> {
  ok: boolean
  error: string
  // Wall-clock milliseconds of the whole run, as the stand saw it.
  wallMs: number
  elapsedMs: number | null
  frames: number | null
  fps: number | null
  realtime: number | null
  bytes: number | null
  duration: number | null
  mode: string | null
  codec: string | null
  flow: string | null
  // The limit of frames in force at the end, and the most frames at once.
  limit: number | null
  // Credits the gate lent above the limit, the floor the limit could not go
  // below, and the time the entrance of the gate was shut, in milliseconds.
  borrowed: number | null
  floor: number | null
  gateMs: number | null
  // The memory budget given to the automatic limit, in MiB, and the number of
  // frames it allows (N_mem).
  budgetMiB: number | null
  memLimit: number | null
  // What the automatic limit worked out: N_perf, the tries to raise the limit
  // and the level they reached, and the rate at each limit tried as
  // "limit:rate" pairs joined by semicolons.
  byThroughput: number | null
  tried: number | null
  climbedTo: number | null
  trials: string
  // λ at the end, the probe's own rate (frames per second) and W0 in
  // milliseconds, as the automatic limit measured them.
  lambdaFps: number | null
  probeFps: number | null
  w0Ms: number | null
  // W0 of the first calibration, where a second measurement replaced it.
  w0FirstMs: number | null
  peakFrames: number | null
  // When the peak was first reached (milliseconds since the start) and the
  // limit in force then.
  peakAtMs: number | null
  limitAtPeak: number | null
  peakFrameMiB: number | null
  peakHeapMiB: number | null
  copiedShare: number | null
  framesCopied: number | null
  framesRecoded: number | null
  thread: string | null
  longestUiMs: number | null
  parts: number | null
  segmentSeconds: number | null
  commits: number | null
  checkpointMs: number | null
  openMs: number | null
  commitMs: number | null
  journalMiB: number | null
  audioMs: number | null
  videoMs: number | null
  assembleMs: number | null
  crashes: number | null
  attempts: number | null
  freshStarts: number | null
  restartMs: number | null
  // How the frames of the file compare with what the project asks for.
  psnrMean: number | null
  psnrMin: number | null
  ssimMean: number | null
  ssimMin: number | null
  identicalShare: number | null
  // Where the time of the export went (see StageTimes): the fields named in
  // STAGE_FIELDS, null where the path of the export does not have the stage.
  // What the plan made before the run said of a selective export: the share
  // it would copy and what stands in the way of copying (empty when nothing).
  plannedShare: number | null
  blockers: string
  // The notes of the export, joined.
  notes: string
}

export const RECORD_COLUMNS: (keyof RunRecord)[] = [
  'series', 'condition', 'label', 'index', 'round', 'warmup', 'ok', 'error', 'wallMs', 'elapsedMs',
  'frames', 'fps', 'realtime', 'bytes', 'duration', 'mode', 'codec', 'flow', 'limit', 'borrowed', 'floor', 'gateMs', 'budgetMiB', 'memLimit',
  'byThroughput', 'tried', 'climbedTo', 'trials', 'lambdaFps', 'probeFps', 'w0Ms', 'w0FirstMs', 'peakFrames', 'peakAtMs', 'limitAtPeak',
  'peakFrameMiB', 'peakHeapMiB', 'copiedShare', 'framesCopied', 'framesRecoded', 'thread',
  'longestUiMs', 'parts', 'segmentSeconds', 'commits', 'checkpointMs', 'openMs', 'commitMs', 'journalMiB',
  'audioMs', 'videoMs', 'assembleMs', 'crashes', 'attempts', 'freshStarts', 'restartMs', 'psnrMean', 'psnrMin', 'ssimMean', 'ssimMin', 'identicalShare',
  ...STAGE_FIELDS, 'plannedShare', 'blockers', 'notes',
]

const EMPTY = {
  elapsedMs: null, frames: null, fps: null, realtime: null, bytes: null, duration: null, mode: null,
  codec: null, flow: null, limit: null, borrowed: null, floor: null, gateMs: null, budgetMiB: null, memLimit: null, byThroughput: null, tried: null, climbedTo: null, trials: '', lambdaFps: null, probeFps: null, w0Ms: null, w0FirstMs: null,
  peakFrames: null, peakAtMs: null, limitAtPeak: null, peakFrameMiB: null, peakHeapMiB: null,
  copiedShare: null, framesCopied: null, framesRecoded: null, thread: null, longestUiMs: null,
  parts: null, segmentSeconds: null, commits: null, checkpointMs: null, openMs: null, commitMs: null,
  journalMiB: null, audioMs: null, videoMs: null, assembleMs: null, crashes: null, attempts: null,
  freshStarts: null, restartMs: null, psnrMean: null, psnrMin: null, ssimMean: null,
  ssimMin: null, identicalShare: null, plannedShare: null, blockers: '', notes: '',
} as const

export function failedRecord(meta: RunMeta, error: unknown, wallMs: number): RunRecord {
  return {
    ...meta,
    ...EMPTY,
    ...NO_STAGES,
    ok: false,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    wallMs: Math.round(wallMs),
  }
}

// What a finished export says, as numbers for the table.
export function recordOf(meta: RunMeta, result: StandResult, wallMs: number): RunRecord {
  const seconds = Math.max(result.elapsedMs, 1) / 1000
  const { stats, journal, memory, flow } = result
  const copiedSeconds = stats?.copiedSeconds ?? 0
  const recodedSeconds = stats?.recodedSeconds ?? 0
  const covered = copiedSeconds + recodedSeconds
  const peak = memory ? peakMoment(memory) : null
  return {
    ...meta,
    ok: true,
    error: '',
    wallMs: Math.round(wallMs),
    elapsedMs: Math.round(result.elapsedMs),
    frames: result.frames,
    fps: result.frames / seconds,
    realtime: result.duration / seconds,
    bytes: result.bytes,
    duration: result.duration,
    mode: result.bench ? `bench-${result.bench}` : result.settings.mode,
    codec: result.settings.container === 'gif' ? 'gif' : `${result.settings.container}/${result.settings.videoCodec}`,
    flow: result.settings.flow,
    limit: flow?.limit ?? null,
    borrowed: flow?.borrowed ?? null,
    floor: flow?.floor ?? null,
    gateMs: flow ? Math.round(flow.waitedMs) : null,
    budgetMiB: flow?.budgetBytes != null ? flow.budgetBytes / MIB : null,
    memLimit: flow?.byMemory ?? null,
    byThroughput: flow?.byThroughput ?? null,
    tried: flow?.tried ?? null,
    climbedTo: flow?.climbedTo ?? null,
    trials: (flow?.trials ?? []).map((item) => `${item.limit}:${Math.round(item.rate)}`).join(';'),
    lambdaFps: flow?.rate ?? null,
    probeFps: flow?.probeRate ?? null,
    w0Ms: flow?.latencyMs ?? null,
    w0FirstMs: flow?.firstLatencyMs ?? null,
    peakFrames: memory?.peakFrames ?? flow?.peak ?? null,
    peakAtMs: peak?.ms ?? null,
    limitAtPeak: peak?.limit ?? null,
    peakFrameMiB: memory ? memory.peakFrameBytes / MIB : null,
    peakHeapMiB: memory?.peakHeapBytes != null ? memory.peakHeapBytes / MIB : null,
    copiedShare: covered > 0 ? copiedSeconds / covered : null,
    framesCopied: stats?.framesCopied ?? null,
    framesRecoded: stats?.framesRecoded ?? null,
    thread: result.thread ?? null,
    longestUiMs: result.ui?.longestMs ?? null,
    parts: journal?.segments ?? null,
    segmentSeconds: journal?.segmentSeconds ?? null,
    commits: journal?.commits ?? null,
    checkpointMs: journal && journal.commits > 0 ? journal.checkpointMs / journal.commits : null,
    openMs: journal && journal.commits > 0 && journal.openMs !== undefined ? journal.openMs / journal.commits : null,
    commitMs: journal && journal.commits > 0 ? journal.commitMs / journal.commits : null,
    journalMiB: journal ? journal.journalBytes / MIB : null,
    audioMs: journal?.audioMs ?? null,
    videoMs: journal?.videoMs ?? null,
    assembleMs: journal?.assembleMs ?? null,
    crashes: result.crash?.crashes ?? null,
    attempts: result.crash?.attempts ?? null,
    freshStarts: result.crash?.fresh ?? null,
    restartMs: result.crash?.restartMs ?? null,
    psnrMean: result.quality?.psnrMean ?? null,
    psnrMin: result.quality?.psnrMin ?? null,
    ssimMean: result.quality?.ssimMean ?? null,
    ssimMin: result.quality?.ssimMin ?? null,
    identicalShare: result.quality ? result.quality.identical / result.quality.frames : null,
    ...stageFigures(result.stages),
    plannedShare: null,
    blockers: '',
    notes: (result.notes ?? []).join(' | '),
  }
}
