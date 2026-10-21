// src/export/frameTiming.ts

// A frame shorter than this is dropped; a frame that reports no duration is
// given the length of one frame of a 30 fps video.
export const MIN_FRAME = 1e-4
export const FALLBACK_FRAME = 1 / 30
