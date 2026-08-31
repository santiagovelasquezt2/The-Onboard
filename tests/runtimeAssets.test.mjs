import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRuntimeAssetConfig,
  runtimeAssetUrl,
} from '../src/runtimeAssets.ts'

test('development keeps the existing local runtime paths', () => {
  const assets = createRuntimeAssetConfig({ DEV: true })

  assert.equal(assets.baseUrl, null)
  assert.equal(assets.replay.url, '/replays/2024-montreal-q-d63-lap22.json')
  assert.equal(assets.trackModelUrl, '/media/track/montreal-runtime-v2.glb')
  assert.equal(assets.carModelUrl, '/media/car/amg-w14-runtime-v2.glb')
  assert.equal(assets.onboardVideoUrl, '/media/onboard.mp4?v=20260821')
  assert.deepEqual(assets.landingReelUrls, [
    '/media/landing/reel1.mp4',
    '/media/landing/reel2.mp4',
    '/media/landing/reel3.mp4',
  ])
})

test('production leaves user-supplied footage absent without an asset origin', () => {
  const assets = createRuntimeAssetConfig({ DEV: false })

  assert.equal(assets.trackModelUrl, '/media/track/montreal-runtime-v2.glb')
  assert.equal(assets.onboardVideoUrl, null)
  assert.equal(assets.landingReelUrls, null)
})

test('one immutable base URL prefixes distributable runtime assets only', () => {
  const assets = createRuntimeAssetConfig({
    DEV: false,
    VITE_ASSET_BASE_URL: 'https://assets.example/releases/v1/',
  })

  assert.equal(assets.baseUrl, 'https://assets.example/releases/v1')
  assert.equal(
    assets.replay.url,
    'https://assets.example/releases/v1/replays/2024-montreal-q-d63-lap22.json',
  )
  assert.equal(
    assets.trackModelUrl,
    'https://assets.example/releases/v1/media/track/montreal-runtime-v2.glb',
  )
  assert.equal(
    assets.helmetModelUrl,
    'https://assets.example/releases/v1/media/helmet/russell-glass-shell.glb?v=shiny-black-visor-v3',
  )
  assert.equal(
    assets.basisTranscoderPath,
    'https://assets.example/releases/v1/basis/',
  )
  assert.equal(assets.onboardVideoUrl, null)
  assert.equal(assets.landingReelUrls, null)
})

test('an explicit onboard URL overrides the shared asset origin', () => {
  const assets = createRuntimeAssetConfig({
    DEV: false,
    VITE_ASSET_BASE_URL: '/release/immutable-42/',
    VITE_ONBOARD_VIDEO_URL: 'https://video.example/russell-lap.mp4?token=public',
    VITE_LANDING_REEL_1_URL: 'https://video.example/reel-1.mp4',
    VITE_LANDING_REEL_2_URL: 'https://video.example/reel-2.mp4',
    VITE_LANDING_REEL_3_URL: 'https://video.example/reel-3.mp4',
    VITE_REPLAY_SHA256:
      '27BB365D4D8891F2590BC3FE6D799CF876961E08B7083842F1F8AE5527A47B0F',
  })

  assert.equal(assets.trackModelUrl, '/release/immutable-42/media/track/montreal-runtime-v2.glb')
  assert.equal(
    assets.onboardVideoUrl,
    'https://video.example/russell-lap.mp4?token=public',
  )
  assert.deepEqual(assets.landingReelUrls, [
    'https://video.example/reel-1.mp4',
    'https://video.example/reel-2.mp4',
    'https://video.example/reel-3.mp4',
  ])
  assert.equal(
    assets.replay.sha256,
    '27bb365d4d8891f2590bc3fe6d799cf876961e08b7083842f1f8ae5527a47b0f',
  )
})

test('runtime URL configuration rejects ambiguous or unsafe values', () => {
  assert.throws(
    () => createRuntimeAssetConfig({ VITE_ASSET_BASE_URL: 'cdn.example/assets' }),
    /VITE_ASSET_BASE_URL must be an absolute/u,
  )
  assert.throws(
    () => createRuntimeAssetConfig({ VITE_ASSET_BASE_URL: '//cdn.example' }),
    /protocol-relative/u,
  )
  assert.throws(
    () => createRuntimeAssetConfig({ VITE_ONBOARD_VIDEO_URL: 'javascript:alert(1)' }),
    /must use http\(s\)/u,
  )
  assert.throws(
    () => createRuntimeAssetConfig({ VITE_REPLAY_SHA256: 'not-a-digest' }),
    /64-character hexadecimal/u,
  )
  assert.throws(
    () =>
      createRuntimeAssetConfig({
        VITE_LANDING_REEL_1_URL: 'https://video.example/reel-1.mp4',
      }),
    /must configure all three reel URLs together/u,
  )
  assert.equal(runtimeAssetUrl('/media/car.glb', null), '/media/car.glb')
})
