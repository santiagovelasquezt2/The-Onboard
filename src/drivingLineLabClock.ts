import { CALIBRATION_RECORDING_VIDEO_LEAD_SECONDS } from './calibrationVideoLead.ts'

export const DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS =
  CALIBRATION_RECORDING_VIDEO_LEAD_SECONDS

export type DrivingLineLabCameraView = 'overhead' | 'onboard'

type DrivingLineLabLapWindow = {
  videoStartSeconds: number
  lapDurationSeconds: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function safeLeadSeconds(value: number) {
  return Math.max(0, finiteOr(value, 0))
}

/**
 * Aerial positioning keeps the requested preview head-start. Direct onboard
 * comparison uses the same lap time in both feeds so landmarks line up.
 */
export function drivingLineVideoLeadForCameraView(
  cameraView: DrivingLineLabCameraView,
) {
  return cameraView === 'overhead'
    ? DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS
    : 0
}

export function drivingLinePreviewLapTimeFromVehicleLapTime(
  vehicleLapTimeSeconds: number,
  lapDurationSeconds: number,
  videoLeadSeconds = DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS,
) {
  const duration = Math.max(0, finiteOr(lapDurationSeconds, 0))
  const lead = safeLeadSeconds(videoLeadSeconds)
  return clamp(
    finiteOr(vehicleLapTimeSeconds, 0) + lead,
    0,
    duration + lead,
  )
}

export function drivingLineVehicleLapTimeFromPreviewLapTime(
  previewLapTimeSeconds: number,
  lapDurationSeconds: number,
  videoLeadSeconds = DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS,
) {
  const duration = Math.max(0, finiteOr(lapDurationSeconds, 0))
  return clamp(
    finiteOr(previewLapTimeSeconds, 0) - safeLeadSeconds(videoLeadSeconds),
    0,
    duration,
  )
}

export function drivingLineSourceVideoTimeFromVehicleLapTime(
  vehicleLapTimeSeconds: number,
  lapWindow: DrivingLineLabLapWindow,
  videoLeadSeconds = DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS,
) {
  return (
    finiteOr(lapWindow.videoStartSeconds, 0) +
    drivingLinePreviewLapTimeFromVehicleLapTime(
      vehicleLapTimeSeconds,
      lapWindow.lapDurationSeconds,
      videoLeadSeconds,
    )
  )
}
