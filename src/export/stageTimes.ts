// src/export/stageTimes.ts

// Where the time of an export goes, in milliseconds. A stage that a path of
// the export does not have stays at zero (or null for the "first" times).
export interface StageTimes {
  // Waiting for the next frame (or packet) from the side of the decoder.
  waitMs: number
  // Painting the frames on the canvas.
  composeMs: number
  // Inside the encoder's add, the wait for room in its queue included.
  encodeMs: number
  // From the start of the loop until the encoder has taken the first frame;
  // null when no frame went to the encoder.
  firstFrameMs: number | null
  // Before the loop: opening the files, the sink, the output and, for the
  // selective export, the analysis and the plan.
  setupMs: number
  // After the loop: closing the output and making the file.
  finishMs: number
  // From the start of the loop until the first item came out of the merged
  // stream (a frame, a packet or a block of sound).
  firstItemMs: number | null
  // The first add of the encoder in the run: the encoder's own start is in it.
  firstAddMs: number | null
  // Time spent inside the video and the audio stream while they were asked
  // for their next item. The two run side by side, so they do not add up to
  // waitMs.
  videoPullMs: number
  audioPullMs: number
  // Inside the audio encoder's add.
  audioAddMs: number
  // Starting encoder sessions: the output, the source and its start.
  startRunMs: number
  // Closing an encoder session in the middle of the loop (selective).
  endRunMs: number
  // Waiting until a copied packet had been taken by the output (selective).
  sendMs: number
  // Creating the files of the journal's parts (journaled export).
  createMs: number
  // Inside the video stream of the selective export: reading packets of
  // stretches that are copied, finding key packets, and waiting for the
  // decoded frames of stretches that are encoded again.
  readMs: number
  seekMs: number
  decodeMs: number
  // In the setup of the selective export: starting an encoder session to learn
  // the stream parameters of its output, and going through the key packets of
  // the files to judge what can be copied.
  probeMs: number
  scanMs: number
  // Selective export: from the start of the loop until the decoder was first
  // asked for a stretch that gave a frame (what came before is copying and
  // edge slivers with no frame in them), and how long that first frame then
  // took to come. Null where nothing is encoded again.
  decodeAskMs: number | null
  firstSampleMs: number | null
}

export const emptyStages = (): StageTimes => ({
  waitMs: 0,
  composeMs: 0,
  encodeMs: 0,
  firstFrameMs: null,
  setupMs: 0,
  finishMs: 0,
  firstItemMs: null,
  firstAddMs: null,
  videoPullMs: 0,
  audioPullMs: 0,
  audioAddMs: 0,
  startRunMs: 0,
  endRunMs: 0,
  sendMs: 0,
  createMs: 0,
  readMs: 0,
  seekMs: 0,
  decodeMs: 0,
  probeMs: 0,
  scanMs: 0,
  decodeAskMs: null,
  firstSampleMs: null,
})

// The part of the times that the video stream of the selective export keeps
// itself, while it reads and decodes.
export interface ReadTimes {
  readMs: number
  seekMs: number
  decodeMs: number
  probeMs: number
  scanMs: number
  decodeAskMs: number | null
  firstSampleMs: number | null
}

export const emptyReadTimes = (): ReadTimes => ({
  readMs: 0,
  seekMs: 0,
  decodeMs: 0,
  probeMs: 0,
  scanMs: 0,
  decodeAskMs: null,
  firstSampleMs: null,
})

// Hands the items of a stream on as they come and tells `add` how long each
// of them was waited for.
export async function* pulled<T>(items: AsyncIterable<T>, add: (ms: number) => void): AsyncGenerator<T> {
  const iterator = items[Symbol.asyncIterator]()
  let finished = false
  try {
    while (true) {
      const began = performance.now()
      const step = await iterator.next()
      add(performance.now() - began)
      if (step.done) {
        finished = true
        return
      }
      yield step.value
    }
  } finally {
    if (!finished) await iterator.return?.()
  }
}

// Hands the items of a stream on as they come and adds the time spent waiting
// for each of them to `stages`; notes when the first one came.
export function timedItems<T>(items: AsyncIterable<T>, stages: StageTimes): AsyncGenerator<T> {
  const origin = performance.now()
  return pulled(items, (ms) => {
    stages.waitMs += ms
    stages.firstItemMs ??= performance.now() - origin
  })
}
