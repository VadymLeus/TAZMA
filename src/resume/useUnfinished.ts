// src/resume/useUnfinished.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { removeStale } from './cleanup.ts'
import { listUnfinished } from './jobs.ts'
import type { JobSummary } from './jobs.ts'
import { removeJob } from './store.ts'

// The journals of unfinished exports in the browser's private storage. The
// first reading after the page opens also removes the ones nobody has touched
// for a week. The list is read again when the tab is focused, since another
// tab may have left a journal or taken one up.
export function useUnfinished() {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [ready, setReady] = useState(false)
  const cleaned = useRef(false)

  const refresh = useCallback(async () => {
    try {
      let list = await listUnfinished()
      if (!cleaned.current) {
        cleaned.current = true
        list = await removeStale(list, Date.now(), removeJob)
      }
      setJobs(list)
    } catch {
      setJobs([])
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const remove = useCallback(
    async (job: string) => {
      await removeJob(job)
      await refresh()
    },
    [refresh],
  )

  const removeAll = useCallback(async () => {
    for (const item of jobs) if (!item.active) await removeJob(item.job)
    await refresh()
  }, [jobs, refresh])

  return { jobs, ready, refresh, remove, removeAll }
}
