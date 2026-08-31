import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const lapModelsUrl = new URL(
  '../../../src/features/replay/scene/LapModels.tsx',
  import.meta.url,
)
const trackSceneUrl = new URL(
  '../../../src/features/replay/scene/TrackScene.tsx',
  import.meta.url,
)
const drivingLineLabUrl = new URL(
  '../../../src/features/replay/calibration/DrivingLineLabPage.tsx',
  import.meta.url,
)

test('paused media seeks request a post-seek demand frame', async () => {
  const source = await readFile(lapModelsUrl, 'utf8')

  assert.match(source, /video\.addEventListener\('seeked', handleSeeked\)/u)
  assert.match(
    source,
    /video\.removeEventListener\('seeked', handleSeeked\)/u,
  )
})

test('paused lab ref edits cross the memo boundary with one render epoch', async () => {
  const [trackSceneSource, labSource] = await Promise.all([
    readFile(trackSceneUrl, 'utf8'),
    readFile(drivingLineLabUrl, 'utf8'),
  ])

  assert.match(trackSceneSource, /function SceneRenderEpochInvalidator/u)
  assert.match(
    trackSceneSource,
    /<SceneRenderEpochInvalidator epoch=\{sceneRenderEpoch\} \/>/u,
  )
  assert.match(labSource, /setSceneRenderEpoch\(\(current\) => current \+ 1\)/u)
  assert.match(labSource, /sceneRenderEpoch=\{sceneRenderEpoch\}/u)
})

test('scene ownership cleanup preserves shared GLTF resources', async () => {
  const source = await readFile(lapModelsUrl, 'utf8')

  assert.match(source, /disposeGeneratedBatchedMeshes\(root\)/u)
  assert.match(source, /for \(const material of resources\.materials\) material\.dispose\(\)/u)
  assert.doesNotMatch(source, /material\.map\?\.dispose\(\)/u)
})

test('camera-wing groups hide their full subtree before car batching', async () => {
  const source = await readFile(lapModelsUrl, 'utf8')

  assert.match(source, /if \(!\/camera_wing\/i\.test\(object\.name\)\) return/u)
  assert.match(source, /object\.traverse\(\(descendant\) => \{/u)
  assert.match(source, /descendant\.visible = false/u)
})
