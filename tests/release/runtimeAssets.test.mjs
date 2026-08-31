import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  activeManifestAssets,
  isAllowedBuildOutput,
  loadManifest,
  validateManifest,
  verifyRuntimeAssets,
} from '../../scripts/release/runtime-assets.mjs'

test('release manifest is complete and valid', async () => {
  const manifest = await loadManifest()
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.assets.length, 19)
  assert.equal(manifest.assets.filter((asset) => asset.delivery === 'runtime').length, 11)
})

test('external asset base stages only bundled assets', async () => {
  const manifest = await loadManifest()
  const active = activeManifestAssets(manifest, {
    VITE_ASSET_BASE_URL: 'https://cdn.example/release/immutable-id',
  })
  assert.equal(active.assetBaseUrl, 'https://cdn.example/release/immutable-id')
  assert.ok(active.assets.every((asset) => asset.delivery === 'bundled'))
  assert.equal(active.assets.length, 8)
})

test('external runtime assets require the manifest replay digest', async () => {
  await assert.rejects(
    verifyRuntimeAssets({
      VITE_ASSET_BASE_URL: 'https://cdn.example/release/immutable-id',
    }),
    /VITE_REPLAY_SHA256 is required/,
  )
  await assert.doesNotReject(
    verifyRuntimeAssets({
      VITE_ASSET_BASE_URL: 'https://cdn.example/release/immutable-id',
      VITE_REPLAY_SHA256: '27bb365d4d8891f2590bc3fe6d799cf876961e08b7083842f1f8ae5527a47b0f',
    }),
  )
})

test('asset base requires a clean HTTPS URL', async () => {
  const manifest = await loadManifest()
  assert.throws(
    () => activeManifestAssets(manifest, { VITE_ASSET_BASE_URL: 'http://cdn.example' }),
    /must use HTTPS/,
  )
  assert.throws(
    () => activeManifestAssets(manifest, { VITE_ASSET_BASE_URL: 'https://cdn.example/?v=1' }),
    /must not contain credentials/,
  )
})

test('manifest rejects deployable files outside the exact allowlist', async () => {
  const manifest = await loadManifest()
  const document = structuredClone(manifest)
  document.assets.push({
    id: 'source-blender',
    source: 'public/media/track/montreal.blend',
    output: 'media/track/montreal.blend',
    delivery: 'runtime',
    bytes: 1,
    sha256: '0'.repeat(64),
  })
  assert.throws(() => validateManifest(document), /outside the production allowlist/)
})

test('build output allowlist excludes source models and media', async () => {
  const manifest = await loadManifest()
  const outputs = new Set(manifest.assets.map((asset) => asset.output))
  assert.equal(isAllowedBuildOutput('index.html', outputs), true)
  assert.equal(isAllowedBuildOutput('404.html', outputs), true)
  assert.equal(isAllowedBuildOutput('THIRD_PARTY_NOTICES.txt', outputs), true)
  assert.equal(isAllowedBuildOutput('THIRD_PARTY_LICENSES.md', outputs), true)
  assert.equal(isAllowedBuildOutput('assets/index-a1b2c3.js', outputs), true)
  assert.equal(isAllowedBuildOutput('media/track/montreal-runtime-v2.glb', outputs), true)
  assert.equal(isAllowedBuildOutput('media/onboard.mp4', outputs), true)
  assert.equal(isAllowedBuildOutput('media/landing/reel1.mp4', outputs), true)
  assert.equal(isAllowedBuildOutput('assets/montreal.glb', outputs), false)
  assert.equal(isAllowedBuildOutput('media/track/montreal.blend', outputs), false)
  assert.equal(isAllowedBuildOutput('media/landing/reel.mp4', outputs), false)
  assert.equal(isAllowedBuildOutput('UNREVIEWED_NOTES.md', outputs), false)
})
