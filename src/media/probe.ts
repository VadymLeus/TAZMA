// src/media/probe.ts
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'

export interface VideoTrackInfo {
  codec: string | null
  codecString: string | null
  width: number
  height: number
  rotation: number
  frameRate: number
  bitrate: number | null
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
  format: string
  mimeType: string
  duration: number
  video: VideoTrackInfo | null
  audio: AudioTrackInfo | null
  videoTrackCount: number
  audioTrackCount: number
}

export interface KeyframeInfo {
  timestamps: number[]
  count: number
  averageInterval: number | null
  maxInterval: number | null
}

function openInput(file: File): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
}

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
      // An estimate from the first packets is enough and keeps long files fast.
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

// Reads packet metadata only; returns null without video or when aborted.
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
