export type PlaybackClock = {
  lapTimeSeconds: number
  initialized: boolean
  previousVideoLapTimeSeconds: number | null
  didSeek: boolean
}

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
  videoLapTimeSeconds: number
  isPlaying: boolean
  /** Set only for an intentional UI/app seek, never for media decode stalls. */
  explicitSeek?: boolean
}

/**
 * Advance a monotonic playback clock that stays aligned with video lap time.
 *
 * The media timestamp is the source of truth. Decode stalls therefore hold
 * the 3D pose instead of being misclassified as seeks, and resuming playback
 * stays exactly aligned with the footage. Only deliberate seeks (or an
 * unmistakable backwards media seek) hard-snap the clock.
 */
export function advancePlaybackClock(
  clock: PlaybackClock,
  options: AdvancePlaybackClockOptions,
): number {
  const { videoLapTimeSeconds, isPlaying, explicitSeek = false } = options

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
    return clock.lapTimeSeconds
  }

  clock.lapTimeSeconds = Math.max(
    clock.lapTimeSeconds,
    videoLapTimeSeconds,
  )

  clock.previousVideoLapTimeSeconds = videoLapTimeSeconds
  return clock.lapTimeSeconds
}
