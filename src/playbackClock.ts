import {
  PLAYBACK_DRIFT_CORRECTION_SECONDS,
  PLAYBACK_MAX_DRIFT_SECONDS,
  PLAYBACK_SEEK_THRESHOLD_SECONDS,
} from './components/scene/sceneConfig'

export type PlaybackClock = {
  lapTimeSeconds: number
  initialized: boolean
  previousVideoLapTimeSeconds: number | null
  didSeek: boolean
}

export function createPlaybackClock(): PlaybackClock {
  return {
    lapTimeSeconds: 0,
    initialized: false,
    previousVideoLapTimeSeconds: null,
    didSeek: false,
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
}

export type AdvancePlaybackClockOptions = {
  deltaSeconds: number
  videoLapTimeSeconds: number
  isPlaying: boolean
  playbackRate?: number
  seekThresholdSeconds?: number
  maxDriftSeconds?: number
  driftCorrectionSeconds?: number
}

/**
 * Advance a monotonic playback clock that stays aligned with video lap time.
 *
 * While playing, the clock advances by frame delta and gently corrects small
 * drift toward the video. Hard snaps occur on explicit seeks or large drift.
 * While paused, the clock follows the video position exactly.
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
    seekThresholdSeconds = PLAYBACK_SEEK_THRESHOLD_SECONDS,
    maxDriftSeconds = PLAYBACK_MAX_DRIFT_SECONDS,
    driftCorrectionSeconds = PLAYBACK_DRIFT_CORRECTION_SECONDS,
  } = options

  clock.didSeek = false
  const previousVideo = clock.previousVideoLapTimeSeconds

  const videoJump =
    previousVideo !== null &&
    Math.abs(videoLapTimeSeconds - previousVideo) >
      seekThresholdSeconds + Math.max(0, deltaSeconds * playbackRate * 1.5)

  if (!clock.initialized || videoJump) {
    resetPlaybackClock(clock, videoLapTimeSeconds)
    clock.didSeek = true
    return clock.lapTimeSeconds
  }

  if (!isPlaying) {
    clock.lapTimeSeconds = videoLapTimeSeconds
    clock.previousVideoLapTimeSeconds = videoLapTimeSeconds
    return clock.lapTimeSeconds
  }

  clock.lapTimeSeconds += deltaSeconds * playbackRate
  const drift = videoLapTimeSeconds - clock.lapTimeSeconds

  if (Math.abs(drift) > maxDriftSeconds) {
    clock.lapTimeSeconds = videoLapTimeSeconds
    clock.didSeek = true
  } else if (Math.abs(drift) > 1e-6 && driftCorrectionSeconds > 0) {
    const correctionAlpha =
      1 - Math.exp(-deltaSeconds / driftCorrectionSeconds)
    clock.lapTimeSeconds += drift * correctionAlpha
  }

  clock.previousVideoLapTimeSeconds = videoLapTimeSeconds
  return clock.lapTimeSeconds
}
