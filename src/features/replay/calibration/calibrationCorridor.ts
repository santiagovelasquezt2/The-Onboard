/**
 * Lets a manual take reach the white line without loosening the automatic
 * replay line. The allowance can never consume more than the corridor's
 * existing safety margin, so the car centre remains on modeled asphalt/kerb
 * rather than reaching the runoff or a nearby access road.
 */
export function expandManualCalibrationBounds(
  minimumOffsetMeters: number,
  maximumOffsetMeters: number,
  safetyMarginMeters: number,
  whiteLineAllowanceMeters: number,
) {
  const allowance = Math.min(
    Math.max(0, safetyMarginMeters),
    Math.max(0, whiteLineAllowanceMeters),
  )
  return {
    minimumOffsetMeters: minimumOffsetMeters - allowance,
    maximumOffsetMeters: maximumOffsetMeters + allowance,
  }
}

/**
 * Limit a manual two-wheel exit so the opposite wheel pair still remains
 * inside the white line. The allowance is measured from the white line to the
 * car centre, not from the automatic safe corridor.
 */
export function twoWheelOutsideWhiteLineAllowance(
  requestedAllowanceMeters: number,
  wheelCenterHalfTrackMeters: number,
  insideTireInsetMeters: number,
): number {
  return Math.min(
    Math.max(0, requestedAllowanceMeters),
    Math.max(
      0,
      wheelCenterHalfTrackMeters - Math.max(0, insideTireInsetMeters),
    ),
  )
}
