// src/stand/gaps.ts
import { mulberry32 } from './schedule.ts'

// The gaps between cuts of one export, in milliseconds: exponential with the
// given mean, drawn from a stream that depends on the seed and the round only.
// Every condition of a round sees the same gaps, so that a difference between
// conditions is not a difference between lucky and unlucky draws.
export function exponentialGaps(seed: number, stream: number, meanMs: number): () => number {
  if (!(meanMs > 0) || !Number.isFinite(meanMs)) throw new RangeError('Середній проміжок між обривами має бути додатним.')
  const random = mulberry32(Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((stream | 0) + 7, 0x85ebca6b))
  return () => -meanMs * Math.log(1 - random())
}
