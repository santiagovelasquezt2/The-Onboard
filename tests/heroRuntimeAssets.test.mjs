import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const heroSourceUrl = new URL(
  '../src/features/hero/HeroPage.tsx',
  import.meta.url,
)
const iconSourceUrl = new URL('../src/ui/Icon.tsx', import.meta.url)
const iconSpriteUrl = new URL('../public/icons.svg', import.meta.url)
const packageMetadataUrl = new URL(
  '../node_modules/@pmndrs/assets/package.json',
  import.meta.url,
)

test('hero environment is a compact, pinned CC0 package asset', async () => {
  const [{ default: environmentUrl }, packageMetadataRaw] = await Promise.all([
    import('@pmndrs/assets/hdri/apartment.exr.js'),
    readFile(packageMetadataUrl, 'utf8'),
  ])
  const packageMetadata = JSON.parse(packageMetadataRaw)
  const prefix = 'data:application/exr;base64,'

  assert.equal(packageMetadata.version, '1.7.0')
  assert.equal(packageMetadata.license, 'CC0-1.0')
  assert.ok(environmentUrl.startsWith(prefix))

  const bytes = Buffer.from(environmentUrl.slice(prefix.length), 'base64')
  assert.equal(bytes.length, 100_399)
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '31c62c03b5686b3d899071070ec1bfc760a3ddc1e6a05915ebc28102fef2fb1c',
  )
})

test('hero avoids remote environment presets and the Troika text worker', async () => {
  const source = await readFile(heroSourceUrl, 'utf8')

  assert.match(source, /files=\{apartmentEnvironmentUrl\}/u)
  assert.doesNotMatch(source, /\bpreset\s*=/u)
  assert.doesNotMatch(
    source,
    /<Text\b|onSync=|textRenderInfo|troika-three-text/u,
  )
})

test('hero keeps the approved transmission budget and sleeps offscreen', async () => {
  const source = await readFile(heroSourceUrl, 'utf8')

  assert.match(source, /resolution=\{384\}/u)
  assert.match(source, /samples=\{4\}/u)
  assert.match(
    source,
    /frameloop=\{heroCanvasVisible \? 'always' : 'never'\}/u,
  )
})

test('landing uses the restored GitHub mark and keeps its public SVG source', async () => {
  const [heroSource, iconSource, iconSprite] = await Promise.all([
    readFile(heroSourceUrl, 'utf8'),
    readFile(iconSourceUrl, 'utf8'),
    readFile(iconSpriteUrl, 'utf8'),
  ])

  assert.match(
    heroSource,
    /href="https:\/\/github\.com\/santiagovelasquezt2\/Openf1-garage"/u,
  )
  assert.match(heroSource, /<Icon name="github" \/>/u)
  assert.match(heroSource, /<SilentErrorBoundary label="hero scene">/u)
  assert.doesNotMatch(heroSource, /<Icon name="code" \/>/u)
  assert.match(iconSource, /name === 'github'/u)
  assert.match(iconSource, /fill="currentColor"/u)
  assert.match(iconSprite, /<symbol id="github-icon" viewBox="0 0 19 19">/u)
})
