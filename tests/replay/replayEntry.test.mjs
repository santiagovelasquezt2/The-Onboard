import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSourceUrl = new URL('../../src/main.tsx', import.meta.url)
const replaySourceUrl = new URL(
  '../../src/features/replay/ReplayPage.tsx',
  import.meta.url,
)

test('landing-to-replay navigation has no added interstitial page', async () => {
  const [mainSource, replaySource] = await Promise.all([
    readFile(mainSourceUrl, 'utf8'),
    readFile(replaySourceUrl, 'utf8'),
  ])

  assert.match(mainSource, /<Suspense fallback=\{null\}>/u)
  assert.doesNotMatch(mainSource, /AppLoadingFallback|RootErrorBoundary/u)
  assert.match(mainSource, /<SilentErrorBoundary label="app">/u)
  assert.doesNotMatch(replaySource, /ReplayEntryLoader|loaderExitComplete/u)
  assert.doesNotMatch(replaySource, /aria-hidden=|\binert=/u)
  assert.match(replaySource, /disabled=\{!videoReady\}/u)
})
