/** The overhead view used while manually placing the car. */
export const CALIBRATION_CAMERA_MIN_HEIGHT_METERS = 14
export const CALIBRATION_CAMERA_MAX_HEIGHT_METERS = 78
export const CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS = 42
export const CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN = 0
export const CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX = 100

export function clampCalibrationCameraHeight(heightMeters: number) {
  return Math.min(
    CALIBRATION_CAMERA_MAX_HEIGHT_METERS,
    Math.max(CALIBRATION_CAMERA_MIN_HEIGHT_METERS, heightMeters),
  )
}

/**
 * Map the Lab's left-to-right distance control to camera height. A logarithmic
 * scale gives each slider step a similar perceived zoom change instead of
 * making most of the far half feel stationary.
 */
export function calibrationCameraHeightFromDistanceControl(value: number) {
  const control = Math.min(
    CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX,
    Math.max(CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN, value),
  )
  const progress =
    (control - CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN) /
    (CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX -
      CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN)
  return (
    CALIBRATION_CAMERA_MIN_HEIGHT_METERS *
    Math.pow(
      CALIBRATION_CAMERA_MAX_HEIGHT_METERS /
        CALIBRATION_CAMERA_MIN_HEIGHT_METERS,
      progress,
    )
  )
}

export function calibrationCameraDistanceControlFromHeight(
  heightMeters: number,
) {
  const height = clampCalibrationCameraHeight(heightMeters)
  const progress =
    Math.log(height / CALIBRATION_CAMERA_MIN_HEIGHT_METERS) /
    Math.log(
      CALIBRATION_CAMERA_MAX_HEIGHT_METERS /
        CALIBRATION_CAMERA_MIN_HEIGHT_METERS,
    )
  return (
    CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN +
    progress *
      (CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX -
        CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN)
  )
}
