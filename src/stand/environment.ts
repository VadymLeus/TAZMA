// src/stand/environment.ts

// What is worth knowing about the machine and the browser a series ran on,
// since the figures mean nothing without it.
export interface Environment {
  date: string
  userAgent: string
  cores: number | null
  deviceMemoryGB: number | null
  crossOriginIsolated: boolean
  // The page's heap can be read (Chromium only).
  heapApi: boolean
  timezone: string
}

export function readEnvironment(): Environment {
  const nav = navigator as Navigator & { deviceMemory?: number }
  let timezone = ''
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timezone = ''
  }
  return {
    date: new Date().toISOString(),
    userAgent: nav.userAgent,
    cores: nav.hardwareConcurrency ?? null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    heapApi: typeof performance !== 'undefined' && 'memory' in performance,
    timezone,
  }
}
