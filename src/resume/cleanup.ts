// src/resume/cleanup.ts
import type { JobSummary } from './jobs.ts'

export const JOURNAL_TTL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

// Journals nobody has touched for this long are removed when the page opens.
export const JOURNAL_TTL_MS = JOURNAL_TTL_DAYS * DAY_MS

// The journals that are too old to be worth keeping: not held by an export of
// another tab, and not touched for the whole of the time-to-live. A journal
// that cannot be read has no date, so it is never taken for old; the person
// removes it by hand.
export function staleJobs(list: JobSummary[], now: number, ttl = JOURNAL_TTL_MS): JobSummary[] {
  return list.filter((item) => !item.active && item.usable && item.updated > 0 && now - item.updated > ttl)
}

// Removes the old journals and gives back the rest of the list.
export async function removeStale(
  list: JobSummary[],
  now: number,
  remove: (job: string) => Promise<void>,
  ttl = JOURNAL_TTL_MS,
): Promise<JobSummary[]> {
  const stale = new Set(staleJobs(list, now, ttl).map((item) => item.job))
  for (const job of stale) await remove(job)
  return list.filter((item) => !stale.has(item.job))
}
