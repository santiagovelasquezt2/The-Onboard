import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_THIRD_PERSON_ORBIT,
  MINIMUM_THIRD_PERSON_CAMERA_HEIGHT_METERS,
  THIRD_PERSON_ORBIT_LIMITS,
  resolveThirdPersonCamera,
  updateThirdPersonOrbit,
} from '../../../src/features/replay/scene/cameraDirector.ts'

test('the third-person orbit remains car-relative and bounded', () => {
  const camera = resolveThirdPersonCamera(DEFAULT_THIRD_PERSON_ORBIT)
  assert.ok(camera.position.forward < camera.target.forward)
  assert.ok(camera.position.up > camera.target.up)

  const limited = updateThirdPersonOrbit(DEFAULT_THIRD_PERSON_ORBIT, {
    pitchRadians: 99,
    distanceMeters: -99,
  })
  assert.ok(limited.pitchRadians < 2)
  assert.ok(limited.distanceMeters > 0)
})

test('negative pitch drag keeps the third-person camera above the car', () => {
  const loweredOrbit = updateThirdPersonOrbit(DEFAULT_THIRD_PERSON_ORBIT, {
    pitchRadians: -99,
    distanceMeters: 99,
  })
  const camera = resolveThirdPersonCamera(loweredOrbit)

  assert.equal(
    loweredOrbit.pitchRadians,
    THIRD_PERSON_ORBIT_LIMITS.minimumPitchRadians,
  )
  assert.ok(
    camera.position.up >= MINIMUM_THIRD_PERSON_CAMERA_HEIGHT_METERS,
  )
})
