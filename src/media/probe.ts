// Reading information about a media file. This module has no UI code: the
// export core will reuse it in later stages.

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'

export interface VideoTrackInfo {
  /** Mediabunny codec name, for example `avc`, `hevc`, `vp9`, `av1`. */
  codec: string | null
  /** Codec parameter string, for example `avc1.640028`. */
  codecString: string | null
  /** Display size in pixels, with rotation already applied. */
  width: number
  height: number
  /** Rotation in degrees: 0, 90, 180 or 270. */
  rotation: number
  /** Average frame rate, frames per second. */
  frameRate: number
  /** Average bitrate, bits per second. */
  bitrate: number | null
  /** Total number of video packets, which equals the number of frames. */
  frameCount: number
}

export interface AudioTrackInfo {
  codec: string | null
  codecString: string | null
  channels: number
  sampleRate: number
  bitrate: number | null
}

export interface MediaInfo {
  fileName: string
  fileSize: number
  /** Container name, for example `MP4`, `Matroska`, `WebM`. */
  format: string
  mimeType: string
  /** Duration in seconds. */
  duration: number
  video: VideoTrackInfo | null
  audio: AudioTrackInfo | null
  videoTrackCount: number
  audioTrackCount: number
}

export interface KeyframeInfo {
  /** Presentation times of key frames in seconds, ascending. */
  timestamps: number[]
  count: number
  /** Average distance between neighbouring key frames, seconds. */
  averageInterval: number | null
  /** Largest distance between neighbouring key frames, seconds. */
  maxInterval: number | null
}

function openInput(file: File): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
}

/** Reads container, duration and the primary video and audio tracks. */
export async function probeFile(file: File): Promise<MediaInfo> {
  const input = openInput(file)
  try {
    const format = await input.getFormat()
    const mimeType = await input.getMimeType()
    const duration = await input.computeDuration()

    const videoTracks = await input.getVideoTracks()
    const audioTracks = await input.getAudioTracks()
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()

    let video: VideoTrackInfo | null = null
    if (videoTrack) {
      const stats = await videoTrack.computePacketStats()
      video = {
        codec: await videoTrack.getCodec(),
        codecString: await videoTrack.getCodecParameterString(),
        width: await videoTrack.getDisplayWidth(),
        height: await videoTrack.getDisplayHeight(),
        rotation: await videoTrack.getRotation(),
        frameRate: stats.averagePacketRate,
        bitrate: stats.averageBitrate,
        frameCount: stats.packetCount,
      }
    }

    let audio: AudioTrackInfo | null = null
    if (audioTrack) {
      // An estimate from the first packets is enough for the bitrate and
      // keeps long files fast to open.
      const stats = await audioTrack.computePacketStats(1000)
      audio = {
        codec: await audioTrack.getCodec(),
        codecString: await audioTrack.getCodecParameterString(),
        channels: await audioTrack.getNumberOfChannels(),
        sampleRate: await audioTrack.getSampleRate(),
        bitrate: stats.averageBitrate,
      }
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      format: format.name,
      mimeType,
      duration,
      video,
      audio,
      videoTrackCount: videoTracks.length,
      audioTrackCount: audioTracks.length,
    }
  } finally {
    input.dispose()
  }
}

/**
 * Finds the key frames of the primary video track without reading frame data
 * (packet metadata only). Returns `null` when the file has no video track or
 * when `signal` is aborted before the scan ends.
 */
export async function scanKeyframes(
  file: File,
  signal?: AbortSignal,
): Promise<KeyframeInfo | null> {
  const input = openInput(file)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null

    const sink = new EncodedPacketSink(track)
    const timestamps: number[] = []
    for await (const packet of sink.packets(undefined, undefined, {
      metadataOnly: true,
    })) {
      if (signal?.aborted) return null
      if (packet.type === 'key') timestamps.push(packet.timestamp)
    }
    if (signal?.aborted) return null

    timestamps.sort((a, b) => a - b)
    return { timestamps, count: timestamps.length, ...intervalStats(timestamps) }
  } finally {
    input.dispose()
  }
}

function intervalStats(sorted: number[]): {
  averageInterval: number | null
  maxInterval: number | null
} {
  if (sorted.length < 2) return { averageInterval: null, maxInterval: null }
  let max = 0
  for (let i = 1; i < sorted.length; i++) {
    max = Math.max(max, sorted[i] - sorted[i - 1])
  }
  const average = (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1)
  return { averageInterval: average, maxInterval: max }
}
