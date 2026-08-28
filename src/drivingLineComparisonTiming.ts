export const DRIVING_LINE_COMPARISON_OFFSET_STORAGE_KEY =
  'theonboard:driving-line-comparison-offset:v1'
export const DRIVING_LINE_COMPARISON_OFFSET_MIN_SECONDS = -0.5
export const DRIVING_LINE_COMPARISON_OFFSET_MAX_SECONDS = 0.5
export const DRIVING_LINE_COMPARISON_OFFSET_STEP_SECONDS = 0.01
export const DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS = 0.1

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function clampDrivingLineComparisonOffset(seconds: number) {
  return Math.min(
    DRIVING_LINE_COMPARISON_OFFSET_MAX_SECONDS,
    Math.max(
      DRIVING_LINE_COMPARISON_OFFSET_MIN_SECONDS,
      finiteOr(seconds, DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS),
    ),
  )
}

export function drivingLineComparisonVehicleTime(
  videoLapTimeSeconds: number,
  durationSeconds: number,
  offsetSeconds: number,
) {
  const duration = Math.max(0, finiteOr(durationSeconds, 0))
  return Math.min(
    duration,
    Math.max(
      0,
      finiteOr(videoLapTimeSeconds, 0) +
        clampDrivingLineComparisonOffset(offsetSeconds),
    ),
  )
}

export function readStoredDrivingLineComparisonOffset() {
  if (typeof window === 'undefined') {
    return DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS
  }
  try {
    const stored = window.localStorage.getItem(
      DRIVING_LINE_COMPARISON_OFFSET_STORAGE_KEY,
    )
    if (stored === null) return DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS
    return clampDrivingLineComparisonOffset(Number(stored))
  } catch {
    return DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS
  }
}

export function storeDrivingLineComparisonOffset(seconds: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      DRIVING_LINE_COMPARISON_OFFSET_STORAGE_KEY,
      clampDrivingLineComparisonOffset(seconds).toFixed(2),
    )
  } catch {
    // The control still works for this session when storage is unavailable.
  }
}
