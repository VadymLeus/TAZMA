// src/project/usePlayback.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { clipStart, locate, playbackStep, timelineDuration } from './timeline.ts'
import type { Clip, Source } from './types.ts'

type Wait = 'ok' | 'error' | 'timeout'

const PLAY_ERROR =
  'Браузер не може відтворити цей файл (імовірно, кодек не підтримується).'

function waitFor(
  video: HTMLVideoElement,
  event: 'loadedmetadata' | 'seeked',
): Promise<Wait> {
  return new Promise((resolve) => {
    const finish = (result: Wait) => {
      clearTimeout(timer)
      video.removeEventListener(event, onDone)
      video.removeEventListener('error', onError)
      resolve(result)
    }
    const onDone = () => finish('ok')
    const onError = () => finish('error')
    const timer = setTimeout(() => finish('timeout'), 4000)
    video.addEventListener(event, onDone)
    video.addEventListener('error', onError)
  })
}

// Plays the whole timeline through one <video> element: it jumps to the next
// clip (or switches the file) when a clip ends. The latest clips and sources
// live in refs so the animation-frame loop never reads stale values.
export function usePlayback(clips: Clip[], sources: Source[]) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clipsRef = useRef(clips)
  const sourcesRef = useRef(sources)
  const headRef = useRef(0)
  const playingRef = useRef(false)
  const busyRef = useRef(false)
  const indexRef = useRef(0)
  const loadedRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const frameRef = useRef(0)

  useEffect(() => {
    clipsRef.current = clips
    sourcesRef.current = sources
  })

  const moveHead = useCallback((time: number) => {
    headRef.current = time
    setPlayhead(time)
  }, [])

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    videoRef.current?.pause()
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
  }, [])

  // Shows the frame at a timeline position; each call cancels the previous one.
  const load = useCallback(
    async (time: number, autoplay: boolean) => {
      const generation = ++generationRef.current
      const video = videoRef.current
      if (!video) return

      const list = clipsRef.current
      const location = locate(list, time)
      if (!location) {
        video.removeAttribute('src')
        video.load()
        loadedRef.current = null
        setError(null)
        moveHead(0)
        return
      }
      const clip = list[location.index]
      const source = sourcesRef.current.find((s) => s.id === clip.sourceId)
      if (!source) return

      moveHead(clipStart(list, location.index) + location.offset)
      busyRef.current = true
      try {
        if (loadedRef.current !== source.id) {
          loadedRef.current = source.id
          video.src = source.url
          const loaded = await waitFor(video, 'loadedmetadata')
          if (generation !== generationRef.current) return
          if (loaded === 'error') {
            loadedRef.current = null
            setError(PLAY_ERROR)
            pause()
            return
          }
        }
        const target = clip.start + location.offset
        if (Math.abs(video.currentTime - target) > 0.001) {
          video.currentTime = target
          await waitFor(video, 'seeked')
          if (generation !== generationRef.current) return
        }
        setError(null)
        indexRef.current = location.index
        if (autoplay) await video.play()
      } catch {
        pause()
      } finally {
        if (generation === generationRef.current) busyRef.current = false
      }
    },
    [moveHead, pause],
  )

  const loop: () => void = useCallback(() => {
    frameRef.current = 0
    if (!playingRef.current) return
    const video = videoRef.current
    const list = clipsRef.current
    const clip = list[indexRef.current]
    if (!video || !clip) {
      pause()
      return
    }
    if (!busyRef.current) {
      const time = video.ended ? clip.end : video.currentTime
      const step = playbackStep(list, indexRef.current, time)
      if (step.kind === 'play') {
        moveHead(step.playhead)
      } else if (step.kind === 'end') {
        moveHead(timelineDuration(list))
        pause()
        return
      } else if (step.contiguous) {
        indexRef.current = step.index
      } else {
        void load(clipStart(list, step.index), true)
      }
    }
    frameRef.current = requestAnimationFrame(loop)
  }, [load, moveHead, pause])

  const play = useCallback(async () => {
    const list = clipsRef.current
    if (list.length === 0 || playingRef.current) return
    const from =
      headRef.current >= timelineDuration(list) - 0.01 ? 0 : headRef.current
    playingRef.current = true
    setPlaying(true)
    await load(from, true)
    if (playingRef.current && !frameRef.current) {
      frameRef.current = requestAnimationFrame(loop)
    }
  }, [load, loop])

  const toggle = useCallback(() => {
    if (playingRef.current) pause()
    else void play()
  }, [pause, play])

  const seek = useCallback(
    (time: number) => {
      const total = timelineDuration(clipsRef.current)
      void load(Math.min(Math.max(time, 0), total), playingRef.current)
    },
    [load],
  )

  // Any edit stops playback and re-aligns the preview with the playhead.
  useEffect(() => {
    pause()
    void load(Math.min(headRef.current, timelineDuration(clips)), false)
  }, [clips, load, pause])

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  return { videoRef, playhead, playing, error, toggle, seek }
}
