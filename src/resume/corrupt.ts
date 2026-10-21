// src/resume/corrupt.ts

// A journal file that cannot be trusted: wrong format, cut short, or changed.
export class JournalCorrupt extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalCorrupt'
  }
}
