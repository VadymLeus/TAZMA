// src/resume/configs.ts

// A decoder configuration as the journal keeps it: plain JSON, with the
// description (the avcC or Opus header bytes) as base64.
export type StoredConfig = Record<string, unknown>

export function toBase64(bytes: Uint8Array): string {
  let text = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(text)
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return null
}

export function configToStored(config: object): StoredConfig {
  const stored: StoredConfig = {}
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || typeof value === 'function') continue
    const bytes = key === 'description' ? bytesOf(value) : null
    stored[key] = bytes ? toBase64(bytes) : JSON.parse(JSON.stringify(value))
  }
  return stored
}

export function configFromStored<T>(stored: StoredConfig): T {
  const config: Record<string, unknown> = { ...stored }
  if (typeof stored.description === 'string') config.description = fromBase64(stored.description)
  return config as T
}

// Whether a decoder configuration describes the stream a stored one does: the
// same codec string and the same description bytes. Packets of two encoder
// sessions can share one track only if these agree.
export function sameStream(stored: StoredConfig, config: object): boolean {
  const now = configToStored(config)
  return now.codec === stored.codec && now.description === stored.description
}
