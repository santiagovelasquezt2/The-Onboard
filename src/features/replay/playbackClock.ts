import {
  PLAYBACK_DRIFT_CORRECTION_SECONDS,
  PLAYBACK_MAX_DRIFT_SECONDS,
} from './scene/sceneConfig.ts'

export type PlaybackClock = {
  lapTimeSeconds: number
  initialized: boolean
  previousVideoLapTimeSeconds: number | null
  didSeek: boolean
  stalledSeconds: number
}

const PLAYBACK_DECODE_STALL_SECONDS = 0.1

/** Mutable hand-off from an intentional UI seek to the render loop. */
export type ReplaySeekState = {
  seekEpoch: number
  pendingLapTimeSeconds: number | null
}

export function createPlaybackClock(): PlaybackClock {
  return {
    lapTimeSeconds: 0,
    initialized: false,
    previousVideoLapTimeSeconds: null,
    didSeek: false,
    stalledSeconds: 0,
  }
}

export function resetPlaybackClock(
  clock: PlaybackClock,
  lapTimeSeconds: number,
): void {
  clock.lapTimeSeconds = lapTimeSeconds
  clock.initialized = true
  clock.previousVideoLapTimeSeconds = lapTimeSeconds
  clock.didSeek = false
  clock.stalledSeconds = 0
}

export type AdvancePlaybackClockOptions = {
  deltaSeconds: number
  videoLapTimeSeconds: number
  isPlaying: boolean
  playbackRate?: number
  /** Set only for an intentional UI/app seek, never for media decode stalls. */
  explicitSeek?: boolean
  maxDriftSeconds?: number
  driftCorrectionSeconds?: number
}

/**
 * Advance a monotonic playback clock that stays aligned with video lap time.
 *
 * Frame deltas provide continuous motion between quantized media timestamps.
 * Small drift is eased out while the video is advancing; sustained decode
 * stalls hold the media pose. Only deliberate or backwards seeks set didSeek.
 */
export function advancePlaybackClock(
  clock: PlaybackClock,
  options: AdvancePlaybackClockOptions,
): number {
  const {
    deltaSeconds,
    videoLapTimeSeconds,
    isPlaying,
    playbackRate = 1,
    explicitSeek = false,
    maxDriftSeconds = PLAYBACK_MAX_DRIFT_SECONDS,
    driftCorrectionSeconds = PLAYBACK_DRIFT_CORRECTION_SECONDS,
  } = options

  clock.didSeek = false
  const previousVideo = clock.previousVideoLapTimeSeconds
  const videoMovedBackwards =
    previousVideo !== null &&
    videoLapTimeSeconds < previousVideo - 0.05

  if (!clock.initialized || explicitSeek || videoMovedBackwards) {
    resetPlaybackClock(clock, videoLapTimeSeconds)
    clock.didSeek = true
    return clock.lapTimeSeconds
  }

  if (!isPlaying) {
    clock.lapTimeSeconds = videoLapTimeSeconds
    clock.previousVideoLapTimeSeconds = videoLapTimeSeconds
    clock.stalledSeconds = 0
    return clock.lapTimeSeconds
  }

  const frameDelta = Math.min(Math.max(0, deltaSeconds), 0.05)
  const videoAdvanced =
    previousVideo !== null && videoLapTimeSeconds > previousVideo

  if (videoAdvanced) {
    clock.stalledSeconds = 0
  } else {
    clock.stalledSeconds += frameDelta
  }

  if (clock.stalledSeconds > PLAYBACK_DECODE_STALL_SECONDS) {
    clock.lapTimeSeconds = videoLapTimeSeconds
    clock.previousVideoLapTimeSeconds = videoLapTimeSeconds
    return clock.lapTimeSeconds
  }

  clock.lapTimeSeconds += frameDelta * playbackRate
  const drift = videoLapTimeSeconds - clock.lapTimeSeconds

  if (Math.abs(drift) > maxDriftSeconds) {
    clock.lapTimeSeconds = videoLapTimeSeconds
  } else if (Math.abs(drift) > 1e-6 && driftCorrectionSeconds > 0) {
    const correctionAlpha =
      1 - Math.exp(-frameDelta / driftCorrectionSeconds)
    clock.lapTimeSeconds += drift * correctionAlpha
  }

  clock.previousVideoLapTimeSeconds = videoLapTimeSeconds
  return clock.lapTimeSeconds
}
