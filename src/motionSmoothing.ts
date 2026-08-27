import * as THREE from 'three'
import {
  CAR_ORIENTATION_RESPONSE_SECONDS,
  CAMERA_HEADING_RESPONSE_SECONDS,
  CAMERA_UP_RESPONSE_SECONDS,
  REPLAY_LATERAL_RESPONSE_SECONDS,
  REPLAY_POSITION_RESPONSE_SECONDS,
} from './components/scene/sceneConfig'

export type SmoothedPoseTarget = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
}

export type SmoothedPoseState = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  velocity: THREE.Vector3
  lateralVelocity: number
  longitudinalVelocity: number
  verticalVelocity: number
  initialized: boolean
}

export function createSmoothedPoseState(): SmoothedPoseState {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    velocity: new THREE.Vector3(),
    lateralVelocity: 0,
    longitudinalVelocity: 0,
    verticalVelocity: 0,
    initialized: false,
  }
}

export function responseAlpha(deltaSeconds: number, responseSeconds: number) {
  if (responseSeconds <= 0) return 1
  return 1 - Math.exp(-deltaSeconds / responseSeconds)
}

/**
 * Critically damped spring toward a target scalar. Returns the new value.
 */
export function criticallyDampedScalar(
  current: number,
  target: number,
  velocity: number,
  deltaSeconds: number,
  responseSeconds: number,
): { value: number; velocity: number } {
  if (responseSeconds <= 0 || deltaSeconds <= 0) {
    return { value: target, velocity: 0 }
  }

  const omega = 2 / responseSeconds
  const displacement = current - target
  const damping = 2 * omega
  const spring = omega * omega
  const acceleration = -spring * displacement - damping * velocity
  const nextVelocity = velocity + acceleration * deltaSeconds
  return {
    value: current + nextVelocity * deltaSeconds,
    velocity: nextVelocity,
  }
}

/**
 * Critically damped spring toward a target vector. Returns the new value.
 */
export function criticallyDampedVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: THREE.Vector3,
  deltaSeconds: number,
  responseSeconds: number,
  out: THREE.Vector3 = current,
): THREE.Vector3 {
  if (responseSeconds <= 0 || deltaSeconds <= 0) {
    velocity.set(0, 0, 0)
    return out.copy(target)
  }

  const omega = 2 / responseSeconds
  const x = current.x - target.x
  const y = current.y - target.y
  const z = current.z - target.z
  const damping = 2 * omega
  const spring = omega * omega

  const accelerationX = -spring * x - damping * velocity.x
  const accelerationY = -spring * y - damping * velocity.y
  const accelerationZ = -spring * z - damping * velocity.z

  velocity.x += accelerationX * deltaSeconds
  velocity.y += accelerationY * deltaSeconds
  velocity.z += accelerationZ * deltaSeconds

  out.x = current.x + velocity.x * deltaSeconds
  out.y = current.y + velocity.y * deltaSeconds
  out.z = current.z + velocity.z * deltaSeconds
  return out
}

export type ApplySmoothedPoseOptions = {
  positionResponseSeconds?: number
  lateralResponseSeconds?: number
  orientationResponseSeconds?: number
  headingResponseSeconds?: number
  upResponseSeconds?: number
}

const POSITION_ERROR = new THREE.Vector3()

export function snapSmoothedPose(
  state: SmoothedPoseState,
  target: SmoothedPoseTarget,
): void {
  state.position.copy(target.position)
  state.quaternion.copy(target.quaternion)
  state.forward.copy(target.forward)
  state.right.copy(target.right)
  state.up.copy(target.up)
  state.velocity.set(0, 0, 0)
  state.lateralVelocity = 0
  state.longitudinalVelocity = 0
  state.verticalVelocity = 0
  state.initialized = true
}

export function resetSmoothedPose(state: SmoothedPoseState): void {
  state.velocity.set(0, 0, 0)
  state.lateralVelocity = 0
  state.longitudinalVelocity = 0
  state.verticalVelocity = 0
  state.initialized = false
}

export function applySmoothedPose(
  state: SmoothedPoseState,
  target: SmoothedPoseTarget,
  deltaSeconds: number,
  snap: boolean,
  options: ApplySmoothedPoseOptions = {},
): SmoothedPoseState {
  const {
    positionResponseSeconds = REPLAY_POSITION_RESPONSE_SECONDS,
    lateralResponseSeconds = REPLAY_LATERAL_RESPONSE_SECONDS,
    orientationResponseSeconds = CAR_ORIENTATION_RESPONSE_SECONDS,
    headingResponseSeconds = CAMERA_HEADING_RESPONSE_SECONDS,
    upResponseSeconds = CAMERA_UP_RESPONSE_SECONDS,
  } = options

  const frameDelta = Math.min(deltaSeconds, 0.05)

  if (snap || !state.initialized) {
    snapSmoothedPose(state, target)
    return state
  }

  const currentLateral = state.position.dot(target.right)
  const currentLongitudinal = state.position.dot(target.forward)
  const currentVertical = state.position.dot(target.up)
  POSITION_ERROR.copy(target.position).sub(state.position)

  const lateralTarget = currentLateral + POSITION_ERROR.dot(target.right)
  const longitudinalTarget =
    currentLongitudinal + POSITION_ERROR.dot(target.forward)
  const verticalTarget = currentVertical + POSITION_ERROR.dot(target.up)

  const lateral = criticallyDampedScalar(
    currentLateral,
    lateralTarget,
    state.lateralVelocity,
    frameDelta,
    lateralResponseSeconds,
  )
  const longitudinal = criticallyDampedScalar(
    currentLongitudinal,
    longitudinalTarget,
    state.longitudinalVelocity,
    frameDelta,
    positionResponseSeconds,
  )
  const vertical = criticallyDampedScalar(
    currentVertical,
    verticalTarget,
    state.verticalVelocity,
    frameDelta,
    positionResponseSeconds,
  )
  state.lateralVelocity = lateral.velocity
  state.longitudinalVelocity = longitudinal.velocity
  state.verticalVelocity = vertical.velocity
  state.velocity.set(0, 0, 0)

  state.position
    .copy(target.right)
    .multiplyScalar(lateral.value)
    .addScaledVector(target.forward, longitudinal.value)
    .addScaledVector(target.up, vertical.value)

  state.quaternion.slerp(
    target.quaternion,
    responseAlpha(frameDelta, orientationResponseSeconds),
  )

  state.forward
    .lerp(target.forward, responseAlpha(frameDelta, headingResponseSeconds))
    .normalize()
  state.up
    .lerp(target.up, responseAlpha(frameDelta, upResponseSeconds))
    .normalize()
  state.right.crossVectors(state.up, state.forward).normalize()
  state.forward.crossVectors(state.right, state.up).normalize()

  return state
}
