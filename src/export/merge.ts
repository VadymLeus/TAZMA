// src/export/merge.ts

export interface Timed {
  time: number
}

// Merges ordered streams into one ordered by time (ties go to the earlier
// stream). The muxer then gets video and audio interleaved, so it never has to
// hold back one track while waiting for the other. Items that were read but
// not yielded are passed to dispose when iteration stops early.
export async function* mergeByTime<T extends Timed>(
  streams: AsyncIterator<T>[],
  dispose: (item: T) => void = () => {},
): AsyncGenerator<T> {
  const heads: (T | null | undefined)[] = streams.map(() => undefined)

  async function fill(index: number): Promise<void> {
    if (heads[index] !== undefined) return
    const result = await streams[index].next()
    heads[index] = result.done ? null : result.value
  }

  try {
    while (true) {
      await Promise.all(streams.map((_, index) => fill(index)))
      let best = -1
      for (let index = 0; index < heads.length; index++) {
        const head = heads[index]
        if (head && (best < 0 || head.time < (heads[best] as T).time)) best = index
      }
      if (best < 0) return
      const item = heads[best] as T
      heads[best] = undefined
      yield item
    }
  } finally {
    for (const head of heads) if (head) dispose(head)
    await Promise.all(streams.map((stream) => stream.return?.()))
  }
}
