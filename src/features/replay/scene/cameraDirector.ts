/**
 * Replay-camera definitions that are independent of React Three Fiber.
 *
 * Every position and target below is expressed in the car's moving local
 * basis: `right` is +X, `up` is +Y, and `forward` is +Z. LapModels can turn a
 * value into world space by adding scaled car right/up/forward vectors to the
 * current replay pose. Keeping the data car-relative is what lets a chosen
 * third-person angle remain attached to the replay through a seek or corner.
 */

export const MAIN_CAMERA_MODES = ['third-person', 'onboard'] as const

export type MainCameraMode = (typeof MAIN_CAMERA_MODES)[number]

export function isMainCameraMode(value: unknown): value is MainCameraMode {
  return (
    typeof value === 'string' &&
    (MAIN_CAMERA_MODES as readonly string[]).includes(value)
  )
}

/** A vector expressed against the replay car's right/up/forward basis. */
export type CarRelativeOffset = Readonly<{
  right: number
  up: number
  forward: number
}>

/** Camera placement that LapModels can resolve against the current car pose. */
export type CarRelativeCamera = Readonly<{
  position: CarRelativeOffset
  target: CarRelativeOffset
  fovDegrees: number
}>

/**
 * A spherical offset around the moving third-person target.
 *
 * `yawRadians = 0` places the camera directly behind the car. Positive yaw
 * moves the camera toward the car's right; pitch is positive above the target.
 */
export type ThirdPersonOrbit = Readonly<{
  yawRadians: number
  pitchRadians: number
  distanceMeters: number
}>

export type ThirdPersonOrbitDelta = Readonly<{
  yawRadians?: number
  pitchRadians?: number
  distanceMeters?: number
}>

export type ThirdPersonOrbitLimits = Readonly<{
  minimumPitchRadians: number
  maximumPitchRadians: number
  minimumDistanceMeters: number
  maximumDistanceMeters: number
}>

/** Keeps the hand-controlled camera above the car horizon and off the road. */
export const THIRD_PERSON_ORBIT_LIMITS: ThirdPersonOrbitLimits = {
  minimumPitchRadians: 0,
  maximumPitchRadians: 1.18,
  minimumDistanceMeters: 4.5,
  maximumDistanceMeters: 32,
}

/** Minimum camera height above the car origin in the car-relative basis. */
export const MINIMUM_THIRD_PERSON_CAMERA_HEIGHT_METERS = 0.9

/**
 * Matches the existing centered chase framing: 11.5 m behind and 3.8 m above
 * the car, aimed 0.6 m high and 1.1 m ahead of its origin.
 */
export const DEFAULT_THIRD_PERSON_ORBIT: ThirdPersonOrbit = {
  yawRadians: 0,
  pitchRadians: Math.atan2(3.2, 12.6),
  distanceMeters: Math.hypot(3.2, 12.6),
}

export const DEFAULT_THIRD_PERSON_TARGET: CarRelativeOffset = {
  right: 0,
  up: 0.6,
  forward: 1.1,
}

export const DEFAULT_THIRD_PERSON_FOV_DEGREES = 72

const FULL_TURN_RADIANS = Math.PI * 2

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Keeps yaw numerically stable while preserving the represented direction. */
export function normalizeYawRadians(yawRadians: number) {
  if (!Number.isFinite(yawRadians)) return DEFAULT_THIRD_PERSON_ORBIT.yawRadians
  return (
    ((yawRadians + Math.PI) % FULL_TURN_RADIANS + FULL_TURN_RADIANS) %
      FULL_TURN_RADIANS -
    Math.PI
  )
}

/** Returns a safe copy, so it is suitable for React state updates. */
export function clampThirdPersonOrbit(
  orbit: ThirdPersonOrbit,
  limits: ThirdPersonOrbitLimits = THIRD_PERSON_ORBIT_LIMITS,
): ThirdPersonOrbit {
  const pitch = Number.isFinite(orbit.pitchRadians)
    ? orbit.pitchRadians
    : DEFAULT_THIRD_PERSON_ORBIT.pitchRadians
  const distance = Number.isFinite(orbit.distanceMeters)
    ? orbit.distanceMeters
    : DEFAULT_THIRD_PERSON_ORBIT.distanceMeters

  return {
    yawRadians: normalizeYawRadians(orbit.yawRadians),
    pitchRadians: clamp(
      pitch,
      limits.minimumPitchRadians,
      limits.maximumPitchRadians,
    ),
    distanceMeters: clamp(
      distance,
      limits.minimumDistanceMeters,
      limits.maximumDistanceMeters,
    ),
  }
}

/** Applies a drag/wheel delta, then enforces the third-person safety limits. */
export function updateThirdPersonOrbit(
  orbit: ThirdPersonOrbit,
  delta: ThirdPersonOrbitDelta,
  limits: ThirdPersonOrbitLimits = THIRD_PERSON_ORBIT_LIMITS,
): ThirdPersonOrbit {
  return clampThirdPersonOrbit(
    {
      yawRadians: orbit.yawRadians + (delta.yawRadians ?? 0),
      pitchRadians: orbit.pitchRadians + (delta.pitchRadians ?? 0),
      distanceMeters: orbit.distanceMeters + (delta.distanceMeters ?? 0),
    },
    limits,
  )
}

/**
 * Resolves the hand-controlled third-person view in car-local coordinates.
 * The target is separate from the car origin, giving the W14 room in frame
 * without letting user movement become a world-space free camera.
 */
export function resolveThirdPersonCamera(
  orbit: ThirdPersonOrbit = DEFAULT_THIRD_PERSON_ORBIT,
  target: CarRelativeOffset = DEFAULT_THIRD_PERSON_TARGET,
  fovDegrees = DEFAULT_THIRD_PERSON_FOV_DEGREES,
): CarRelativeCamera {
  const safeOrbit = clampThirdPersonOrbit(orbit)
  const horizontalDistance =
    safeOrbit.distanceMeters * Math.cos(safeOrbit.pitchRadians)
  const positionUp = Math.max(
    MINIMUM_THIRD_PERSON_CAMERA_HEIGHT_METERS,
    target.up +
      Math.sin(safeOrbit.pitchRadians) * safeOrbit.distanceMeters,
  )

  return {
    position: {
      right:
        target.right +
        Math.sin(safeOrbit.yawRadians) * horizontalDistance,
      up: positionUp,
      forward:
        target.forward -
        Math.cos(safeOrbit.yawRadians) * horizontalDistance,
    },
    target,
    fovDegrees,
  }
}
