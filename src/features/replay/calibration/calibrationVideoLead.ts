type CalibrationVideoLeadWindow = {
  videoStartSeconds: number
  lapDurationSeconds: number
}

/**
 * While recording a manual section, show the onboard this far ahead of the
 * car. This gives the driver time to anticipate the next steering move.
 */
export const CALIBRATION_RECORDING_VIDEO_LEAD_SECONDS = 0.5

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function clampTimelineTime(
  lapTimeSeconds: number,
  lapWindow: CalibrationVideoLeadWindow,
) {
  const start = -Math.max(0, finiteOr(lapWindow.videoStartSeconds, 0))
  const end = Math.max(0, finiteOr(lapWindow.lapDurationSeconds, 0))
  return Math.min(end, Math.max(start, finiteOr(lapTimeSeconds, 0)))
}

/**
 * The final section has no footage beyond the chequered flag to preview, so
 * keep it synchronous rather than stopping the car short of the boundary.
 */
export function calibrationVideoLeadForRecording(
  recording: boolean,
  sectionEndLapTimeSeconds: number,
  lapWindow: CalibrationVideoLeadWindow,
): number {
  if (
    !recording ||
    sectionEndLapTimeSeconds >= lapWindow.lapDurationSeconds - 1e-6
  ) {
    return 0
  }

  return CALIBRATION_RECORDING_VIDEO_LEAD_SECONDS
}

/** Convert the visible, leading onboard timestamp back to the car clock. */
export function vehicleLapTimeFromPreviewVideoLapTime(
  videoLapTimeSeconds: number,
  videoLeadSeconds: number,
  lapWindow: CalibrationVideoLeadWindow,
): number {
  return clampTimelineTime(
    videoLapTimeSeconds - Math.max(0, videoLeadSeconds),
    lapWindow,
  )
}

/** Convert a car-clock timestamp into the ahead-of-car onboard timestamp. */
export function previewVideoLapTimeFromVehicleLapTime(
  vehicleLapTimeSeconds: number,
  videoLeadSeconds: number,
  lapWindow: CalibrationVideoLeadWindow,
): number {
  return clampTimelineTime(
    vehicleLapTimeSeconds + Math.max(0, videoLeadSeconds),
    lapWindow,
  )
}
