import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  REPLAY_QUALITY_MAX_FRAME_DELTA_SECONDS,
  REPLAY_QUALITY_SETTINGS,
  createReplayQualitySampler,
  observeReplayQualityFrame,
  resetReplayQualitySampler,
  resizeDirectionalShadowMap,
  resolveReplayQualityOverride,
} from '../../../src/features/replay/scene/replayQuality.ts'

function runFrames(sampler, fps, seconds) {
  let observation = null
  const delta = 1 / fps
  for (let frame = 0; frame < Math.ceil(fps * seconds); frame += 1) {
    observation = observeReplayQualityFrame(sampler, delta) ?? observation
  }
  return observation
}

test('stable 60 fps playback retains the high quality tier', () => {
  const sampler = createReplayQualitySampler()
  const observation = runFrames(sampler, 60, 12)

  assert.ok(observation)
  assert.equal(observation.shouldReduce, false)
  assert.equal(sampler.consecutiveSlowWindows, 0)
})

test('two sustained sub-52 fps windows select reduced quality', () => {
  const sampler = createReplayQualitySampler()
  const observation = runFrames(sampler, 45, 7)

  assert.ok(observation)
  assert.equal(observation.shouldReduce, true)
  assert.ok(sampler.consecutiveSlowWindows >= 2)
})

test('one slow window followed by a healthy window does not downgrade', () => {
  const sampler = createReplayQualitySampler()
  runFrames(sampler, 60, 2.1)
  runFrames(sampler, 45, 1.6)
  const observation = runFrames(sampler, 60, 1.6)

  assert.ok(observation)
  assert.equal(observation.shouldReduce, false)
  assert.equal(sampler.consecutiveSlowWindows, 0)
})

test('tab-resume sized frame gaps are ignored and reset clears samples', () => {
  const sampler = createReplayQualitySampler()
  observeReplayQualityFrame(
    sampler,
    REPLAY_QUALITY_MAX_FRAME_DELTA_SECONDS + 0.01,
  )
  assert.deepEqual(sampler, createReplayQualitySampler())

  runFrames(sampler, 45, 4)
  resetReplayQualitySampler(sampler)
  assert.deepEqual(sampler, createReplayQualitySampler())
})

test('quality settings preserve crisp UI while reducing only 3D buffers', () => {
  assert.deepEqual(REPLAY_QUALITY_SETTINGS.high.dpr, [1, 1.5])
  assert.deepEqual(REPLAY_QUALITY_SETTINGS.reduced.dpr, [1, 1.25])
  assert.equal(REPLAY_QUALITY_SETTINGS.high.shadowMapSize, 2048)
  assert.equal(REPLAY_QUALITY_SETTINGS.reduced.shadowMapSize, 1024)
})

test('quality query override is deterministic for live QA', () => {
  assert.equal(resolveReplayQualityOverride('?scene-quality=high'), 'high')
  assert.equal(resolveReplayQualityOverride('?scene-quality=low'), 'reduced')
  assert.equal(resolveReplayQualityOverride('?scene-quality=reduced'), 'reduced')
  assert.equal(resolveReplayQualityOverride('?camera=chase'), null)
})

test('changing shadow quality disposes the stale render target', () => {
  const light = new THREE.DirectionalLight()
  const shadow = light.shadow
  const oldMap = new THREE.WebGLRenderTarget(2048, 2048)
  let disposed = false
  oldMap.dispose = () => {
    disposed = true
  }
  shadow.mapSize.set(2048, 2048)
  shadow.map = oldMap

  assert.equal(resizeDirectionalShadowMap(shadow, 1024), true)
  assert.equal(disposed, true)
  assert.equal(shadow.map, null)
  assert.deepEqual(shadow.mapSize.toArray(), [1024, 1024])
  assert.equal(shadow.needsUpdate, true)
  assert.equal(resizeDirectionalShadowMap(shadow, 1024), false)
})
