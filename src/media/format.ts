// src/media/format.ts
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const s = totalSeconds % 60
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
    : `${m}:${pad(s)}.${pad(ms, 3)}`
}

export function formatBitrate(bitsPerSecond: number | null): string {
  if (bitsPerSecond === null || !Number.isFinite(bitsPerSecond)) return '—'
  if (bitsPerSecond >= 1e6) return `${(bitsPerSecond / 1e6).toFixed(1)} Мбіт/с`
  return `${Math.round(bitsPerSecond / 1e3)} кбіт/с`
}

export function formatFrameRate(framesPerSecond: number): string {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) return '—'
  return `${parseFloat(framesPerSecond.toFixed(2))} к/с`
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  return `${parseFloat(seconds.toFixed(2))} с`
}

const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264 (AVC)',
  hevc: 'H.265 (HEVC)',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
}

export function codecLabel(codec: string | null): string {
  if (codec === null) return 'невідомий'
  return CODEC_LABELS[codec] ?? codec.toUpperCase()
}

export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  return `${seconds.toFixed(1).replace('.', ',')} с`
}
