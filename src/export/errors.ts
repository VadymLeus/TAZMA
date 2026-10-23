// src/export/errors.ts

// A readable cause for the errors a long export tends to end with.
export function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'QuotaExceededError' || /quota|no space/i.test(message)) {
    return 'у сховищі браузера не вистачило місця для результату. Звільніть місце на диску або скоротіть проєкт.'
  }
  if (/allocation failed|out of memory|invalid (typed )?array length|buffer allocation/i.test(message)) {
    return 'браузеру не вистачило пам’яті для результату. Скоротіть проєкт.'
  }
  return message
}

// A failure of the decoder itself, as opposed to a cancelled export, a full
// disk or a broken project.
export function isDecoderError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === 'AbortError') return false
  return error.name === 'EncodingError' || /decoding error/i.test(error.message)
}
