// src/export/gop.ts

// A GOP can be copied as is only when none of its frames is shown outside the
// window between its own key frame and the next one; otherwise some frames
// lean on pictures of the neighbouring GOP (an open GOP).
export function isClosedGop(
  timestamps: number[],
  from: number,
  until: number,
  eps = 1e-6,
): boolean {
  return timestamps.every((time) => time >= from - eps && time < until - eps)
}
