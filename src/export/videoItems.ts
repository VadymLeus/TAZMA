// src/export/videoItems.ts
import type { EncodedPacket, VideoSample } from 'mediabunny'
import type { Segment } from './plan.ts'

// What the video side of an export is made of: a decoded frame to be painted
// and encoded, or a packet of the source file that goes on as it is. `time` is
// the place on the output timeline.
export type FrameItem = { kind: 'frame'; time: number; sample: VideoSample; segment: Segment }
export type PacketItem = { kind: 'packet'; time: number; packet: EncodedPacket }
export type VideoItem = FrameItem | PacketItem
