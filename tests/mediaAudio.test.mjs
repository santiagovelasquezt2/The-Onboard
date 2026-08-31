import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [onboardSource, heroSource] = await Promise.all([
  readFile(
    new URL(
      '../src/features/replay/components/OnboardVideo.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(new URL('../src/features/hero/HeroPage.tsx', import.meta.url), 'utf8'),
])

test('onboard sound is enabled while landing reels stay muted', () => {
  const onboardVideoTag = onboardSource.match(/<video\b[\s\S]*?\/>/u)?.[0]

  assert.ok(onboardVideoTag)
  assert.doesNotMatch(onboardVideoTag, /\b(?:autoPlay|defaultMuted|muted)\b/u)
  assert.match(heroSource, /video\.defaultMuted = true/u)
  assert.match(heroSource, /video\.muted = true/u)
  assert.match(heroSource, /<video\b[\s\S]*?\bmuted\b[\s\S]*?\/>/u)
})
