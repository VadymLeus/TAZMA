// src/stand/download.ts

// Offers text as a file to save. A byte order mark goes in front of CSV so that
// a spreadsheet reads the Ukrainian labels as UTF-8.
export function saveText(name: string, text: string, mime: string): void {
  const bom = mime.startsWith('text/csv') ? '﻿' : ''
  const url = URL.createObjectURL(new Blob([bom + text], { type: `${mime};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// A name for a saved file that tells the series and the moment.
export function fileStem(series: string, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `tazma-${series}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}
