// src/stand/csv.ts

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Rows as CSV text (RFC 4180): the columns in the order given, a point as the
// decimal mark, a missing value as an empty cell.
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(cell).join(',')]
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','))
  return lines.join('\r\n') + '\r\n'
}
