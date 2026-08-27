/**
 * The local Pirelli onboard contains a short run-up from the exit of turn 13
 * before Russell crosses the timing line. The shared clock remains
 * lap-relative, so the source opens at -5.2 s and reaches lap time 0 here.
 *
 * Recalibrate this value when replacing `public/media/onboard.mp4` with a
 * different edit of the same lap. The source clip must contain the complete
 * timed lap after this point.
 */
export const ONBOARD_LAP_START_SECONDS = 5.2

export type LapWindow = {
  /** Seconds from the beginning of the video file to OpenF1 lap time 0. */
  videoStartSeconds: number
  /** Official OpenF1 timed-lap duration. */
  lapDurationSeconds: number
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

/** Keep the product playhead inside the selected timed-lap segment. */
export function clampLapTime(seconds: number, lapDurationSeconds: number) {
  const duration = Math.max(0, finiteOr(lapDurationSeconds, 0))
  return Math.min(duration, Math.max(0, finiteOr(seconds, 0)))
}

/** First shared-clock value represented by the source video's opening frame. */
export function lapTimelineStartSeconds(window: LapWindow) {
  return -Math.max(0, finiteOr(window.videoStartSeconds, 0))
}

/** Include the onboard run-up while still ending at the official lap boundary. */
export function clampLapTimelineTime(seconds: number, window: LapWindow) {
  return Math.min(
    Math.max(0, finiteOr(window.lapDurationSeconds, 0)),
    Math.max(lapTimelineStartSeconds(window), finiteOr(seconds, 0)),
  )
}

/** Convert the shared lap clock into a seek position in the source video. */
export function videoTimeFromLapTime(seconds: number, window: LapWindow) {
  return (
    finiteOr(window.videoStartSeconds, 0) +
    clampLapTimelineTime(seconds, window)
  )
}

/** Convert a source-video timestamp into the bounded shared lap clock. */
export function lapTimeFromVideoTime(videoSeconds: number, window: LapWindow) {
  return clampLapTimelineTime(
    finiteOr(videoSeconds, 0) - finiteOr(window.videoStartSeconds, 0),
    window,
  )
}

export function videoLapEndSeconds(window: LapWindow) {
  return videoTimeFromLapTime(window.lapDurationSeconds, window)
}
