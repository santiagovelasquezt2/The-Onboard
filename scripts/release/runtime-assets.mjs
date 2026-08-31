import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(scriptDirectory, '..', '..')
export const manifestPath = path.join(
  repositoryRoot,
  'config',
  'runtime-assets.json',
)
export const stagingPublicRoot = path.join(
  repositoryRoot,
  '.release',
  'public',
)
export const productionOutputRoot = path.join(repositoryRoot, 'dist')

const MAXIMUM_PRODUCTION_OUTPUT_BYTES = 90 * 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const requiredBundledOutputs = new Set([
  'favicon.svg',
  'THIRD_PARTY_NOTICES.txt',
  'robots.txt',
  'site.webmanifest',
  'sitemap.xml',
  'fonts/ScribbleFont-Regular.otf',
  'fonts/ScribbleFont-Regular.woff2',
])

const requiredRuntimeOutputs = new Set([
  'basis/LICENSE',
  'basis/basis_transcoder.js',
  'basis/basis_transcoder.wasm',
  'replays/2024-montreal-q-d63-lap22.json',
  'media/helmet/russell-glass-shell.glb',
  'media/track/montreal-runtime-v2.glb',
  'media/car/amg-w14-runtime-v2.glb',
])

const requiredGeneratedOutputs = new Set(['THIRD_PARTY_LICENSES.md'])

const requiredBundledLicensePackages = [
  '@babel/runtime',
  '@monogrid/gainmap-js',
  '@pmndrs/assets',
  '@react-three/drei',
  '@react-three/fiber',
  'fflate',
  'its-fine',
  'react',
  'react-dom',
  'react-use-measure',
  'scheduler',
  'suspend-react',
  'three',
  'three-stdlib',
  'use-sync-external-store',
  'zustand',
]

const allowedGeneratedAssetExtensions = new Set([
  '.avif',
  '.css',
  '.jpeg',
  '.jpg',
  '.js',
  '.otf',
  '.png',
  '.svg',
  '.ttf',
  '.wasm',
  '.webp',
  '.woff',
  '.woff2',
])

const allowedTrackedMediaFiles = new Set([
  'public/media/.gitkeep',
  'public/media/README.md',
  'public/media/car/.gitkeep',
  'public/media/car/amg-w14-runtime-v2.glb',
  'public/media/helmet/README.md',
  'public/media/helmet/russell-glass-shell.glb',
  'public/media/track/.gitkeep',
  'public/media/track/montreal-runtime-v2.glb',
])

const allowedTrackedBasisFiles = new Set([
  'public/basis/LICENSE',
  'public/basis/README.md',
  'public/basis/basis_transcoder.js',
  'public/basis/basis_transcoder.wasm',
])

function fail(message) {
  throw new Error(`[release-assets] ${message}`)
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty relative path.`)
  }
  if (value.includes('\\')) {
    fail(`${label} must use POSIX path separators: ${value}`)
  }
  const normalized = path.posix.normalize(value)
  if (
    normalized !== value ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    fail(`${label} is not a safe normalized relative path: ${value}`)
  }
  return normalized
}

function exactSetDifference(expected, actual) {
  return [...expected].filter((value) => !actual.has(value)).sort()
}

export function validateManifest(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    fail('Manifest root must be an object.')
  }
  if (document.schemaVersion !== 1) {
    fail(`Unsupported schemaVersion: ${String(document.schemaVersion)}`)
  }
  if (
    typeof document.releaseId !== 'string' ||
    !ID_PATTERN.test(document.releaseId)
  ) {
    fail('releaseId must be a lowercase, dash-separated identifier.')
  }
  if (!Array.isArray(document.assets) || document.assets.length === 0) {
    fail('assets must be a non-empty array.')
  }

  const ids = new Set()
  const outputs = new Set()
  const assets = document.assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      fail(`assets[${index}] must be an object.`)
    }
    if (typeof asset.id !== 'string' || !ID_PATTERN.test(asset.id)) {
      fail(`assets[${index}].id is invalid.`)
    }
    if (ids.has(asset.id)) fail(`Duplicate asset id: ${asset.id}`)
    ids.add(asset.id)

    const source = normalizeRelativePath(
      asset.source,
      `assets[${index}].source`,
    )
    const output = normalizeRelativePath(
      asset.output,
      `assets[${index}].output`,
    )
    if (source !== `public/${output}`) {
      fail(`${asset.id} must map public/${output} to ${output}.`)
    }
    if (outputs.has(output)) fail(`Duplicate asset output: ${output}`)
    outputs.add(output)

    if (asset.delivery !== 'bundled' && asset.delivery !== 'runtime') {
      fail(`${asset.id} has invalid delivery: ${String(asset.delivery)}`)
    }
    const expectedDelivery = requiredBundledOutputs.has(output)
      ? 'bundled'
      : requiredRuntimeOutputs.has(output)
        ? 'runtime'
        : null
    if (expectedDelivery === null) {
      fail(`Asset is outside the production allowlist: ${output}`)
    }
    if (asset.delivery !== expectedDelivery) {
      fail(`${output} must use delivery=${expectedDelivery}.`)
    }
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
      fail(`${asset.id}.bytes must be a positive safe integer.`)
    }
    if (typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256)) {
      fail(`${asset.id}.sha256 must be a lowercase SHA-256 digest.`)
    }

    return { ...asset, source, output }
  })

  const requiredOutputs = new Set([
    ...requiredBundledOutputs,
    ...requiredRuntimeOutputs,
  ])
  const missing = exactSetDifference(requiredOutputs, outputs)
  const unexpected = exactSetDifference(outputs, requiredOutputs)
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      `Manifest allowlist mismatch (missing: ${missing.join(', ') || 'none'}; ` +
        `unexpected: ${unexpected.join(', ') || 'none'}).`,
    )
  }

  return {
    schemaVersion: document.schemaVersion,
    releaseId: document.releaseId,
    assets,
  }
}

export async function loadManifest(filePath = manifestPath) {
  const raw = await readFile(filePath, 'utf8')
  let document
  try {
    document = JSON.parse(raw)
  } catch (error) {
    fail(
      `Manifest is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  return validateManifest(document)
}

export function resolveAssetBaseUrl(environment = process.env) {
  const configured = environment.VITE_ASSET_BASE_URL?.trim()
  if (!configured) return null

  let parsed
  try {
    parsed = new URL(configured)
  } catch {
    fail('VITE_ASSET_BASE_URL must be an absolute HTTPS URL.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    fail(
      'VITE_ASSET_BASE_URL must use HTTPS and must not contain credentials, a query, or a hash.',
    )
  }
  return parsed.href.replace(/\/$/, '')
}

export function activeManifestAssets(manifest, environment = process.env) {
  const assetBaseUrl = resolveAssetBaseUrl(environment)
  return {
    assetBaseUrl,
    assets: assetBaseUrl
      ? manifest.assets.filter((asset) => asset.delivery === 'bundled')
      : manifest.assets,
  }
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`Resolved path escapes ${resolvedRoot}: ${relativePath}`)
  }
  return resolved
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function verifyFilesAtRoot(assets, root, pathField) {
  await Promise.all(
    assets.map(async (asset) => {
      const relativePath = asset[pathField]
      const filePath = resolveInside(root, relativePath)
      let fileStats
      try {
        fileStats = await lstat(filePath)
      } catch (error) {
        fail(
          `Missing ${asset.id} at ${relativePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
        fail(`${relativePath} must be a regular, non-symlink file.`)
      }
      if (fileStats.size !== asset.bytes) {
        fail(
          `${relativePath} has ${fileStats.size} bytes; manifest expects ${asset.bytes}.`,
        )
      }
      const digest = await sha256File(filePath)
      if (digest !== asset.sha256) {
        fail(`${relativePath} SHA-256 does not match the release manifest.`)
      }
      if (path.posix.extname(relativePath).toLowerCase() === '.glb') {
        const buffer = await readFile(filePath)
        const jsonLength = buffer.readUInt32LE(12)
        const json = JSON.parse(
          buffer
            .subarray(20, 20 + jsonLength)
            .toString('utf8')
            .trimEnd(),
        )
        const privateLocations = []
        const inspect = (value, location) => {
          if (
            typeof value === 'string' &&
            (/^\/(?:Users|home)\//u.test(value) ||
              /^[a-z]:[\\/]/iu.test(value))
          ) {
            privateLocations.push(location)
            return
          }
          if (Array.isArray(value)) {
            value.forEach((entry, index) =>
              inspect(entry, `${location}[${index}]`),
            )
            return
          }
          if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, entry]) =>
              inspect(entry, `${location}.${key}`),
            )
          }
        }
        inspect(json, 'glTF')
        if (privateLocations.length > 0) {
          fail(
            `${relativePath} exposes private absolute paths at ${privateLocations.join(', ')}.`,
          )
        }
      }
    }),
  )
}

export async function verifyRuntimeAssets(environment = process.env) {
  const manifest = await loadManifest()
  const active = activeManifestAssets(manifest, environment)
  const replay = manifest.assets.find((asset) => asset.id === 'golden-lap-replay')
  const replayDigest = environment.VITE_REPLAY_SHA256?.trim()
  if (active.assetBaseUrl && !replayDigest) {
    fail(
      'VITE_REPLAY_SHA256 is required when VITE_ASSET_BASE_URL serves runtime assets externally.',
    )
  }
  if (replayDigest && replayDigest !== replay?.sha256) {
    fail('VITE_REPLAY_SHA256 does not match the golden replay release manifest.')
  }
  await verifyFilesAtRoot(active.assets, repositoryRoot, 'source')
  return { manifest, ...active }
}

async function walkFiles(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      if (entry.isSymbolicLink()) fail(`Symlink is not allowed in build output: ${relativePath}`)
      if (entry.isDirectory()) await visit(absolutePath)
      else if (entry.isFile()) files.push(relativePath)
      else fail(`Unsupported filesystem entry in build output: ${relativePath}`)
    }
  }
  await visit(root)
  return files.sort()
}

export function isAllowedBuildOutput(relativePath, manifestOutputs) {
  const normalized = normalizeRelativePath(relativePath, 'build output')
  if (normalized === 'index.html' || normalized === '404.html') return true
  if (requiredGeneratedOutputs.has(normalized)) return true
  if (manifestOutputs.has(normalized)) return true
  if (!normalized.startsWith('assets/')) return false
  return allowedGeneratedAssetExtensions.has(
    path.posix.extname(normalized).toLowerCase(),
  )
}

export async function generateNotFoundDocument() {
  const indexPath = resolveInside(productionOutputRoot, 'index.html')
  const notFoundPath = resolveInside(productionOutputRoot, '404.html')
  let indexStats
  try {
    indexStats = await lstat(indexPath)
  } catch (error) {
    fail(
      `Cannot generate 404.html without dist/index.html: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  if (!indexStats.isFile() || indexStats.isSymbolicLink()) {
    fail('dist/index.html must be a regular, non-symlink file.')
  }

  await copyFile(indexPath, notFoundPath)
  const [indexDigest, notFoundDigest] = await Promise.all([
    sha256File(indexPath),
    sha256File(notFoundPath),
  ])
  if (indexDigest !== notFoundDigest) {
    fail('Generated 404.html must be an exact copy of index.html.')
  }
  return { bytes: indexStats.size, sha256: indexDigest }
}

export async function stageProductionPublic(environment = process.env) {
  const verified = await verifyRuntimeAssets(environment)
  const releaseRoot = path.dirname(stagingPublicRoot)
  if (
    stagingPublicRoot !== path.join(releaseRoot, 'public') ||
    !releaseRoot.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    fail(`Refusing to reset unsafe staging path: ${stagingPublicRoot}`)
  }

  await rm(stagingPublicRoot, { recursive: true, force: true })
  await mkdir(stagingPublicRoot, { recursive: true })
  await Promise.all(
    verified.assets.map(async (asset) => {
      const source = resolveInside(repositoryRoot, asset.source)
      const destination = resolveInside(stagingPublicRoot, asset.output)
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(source, destination)
    }),
  )
  await verifyFilesAtRoot(verified.assets, stagingPublicRoot, 'output')

  const files = await walkFiles(stagingPublicRoot)
  const allowed = new Set(verified.assets.map((asset) => asset.output))
  const unexpected = files.filter((file) => !allowed.has(file))
  if (unexpected.length > 0) {
    fail(`Unexpected staged files: ${unexpected.join(', ')}`)
  }

  return verified
}

export async function verifyProductionOutput(environment = process.env) {
  const manifest = await loadManifest()
  const active = activeManifestAssets(manifest, environment)
  const files = await walkFiles(productionOutputRoot)
  const manifestOutputs = new Set(active.assets.map((asset) => asset.output))
  const unexpected = files.filter(
    (file) => !isAllowedBuildOutput(file, manifestOutputs),
  )
  if (unexpected.length > 0) {
    fail(`Production output contains non-allowlisted files: ${unexpected.join(', ')}`)
  }

  const missing = exactSetDifference(
    new Set([
      'index.html',
      '404.html',
      ...requiredGeneratedOutputs,
      ...manifestOutputs,
    ]),
    new Set(files),
  )
  if (missing.length > 0) {
    fail(`Production output is missing: ${missing.join(', ')}`)
  }
  if (!files.some((file) => file.startsWith('assets/') && file.endsWith('.js'))) {
    fail('Production output contains no compiled JavaScript asset.')
  }

  const bundledLicenses = await readFile(
    resolveInside(productionOutputRoot, 'THIRD_PARTY_LICENSES.md'),
    'utf8',
  )
  const missingLicensePackages = requiredBundledLicensePackages.filter(
    (packageName) => !bundledLicenses.includes(`## ${packageName} - `),
  )
  if (missingLicensePackages.length > 0) {
    fail(
      `Generated dependency licenses are missing: ${missingLicensePackages.join(', ')}`,
    )
  }

  const [indexDigest, notFoundDigest] = await Promise.all([
    sha256File(resolveInside(productionOutputRoot, 'index.html')),
    sha256File(resolveInside(productionOutputRoot, '404.html')),
  ])
  if (indexDigest !== notFoundDigest) {
    fail('Production 404.html must be an exact copy of index.html.')
  }

  await verifyFilesAtRoot(active.assets, productionOutputRoot, 'output')
  const sizes = await Promise.all(
    files.map(async (file) => (await lstat(resolveInside(productionOutputRoot, file))).size),
  )
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0)
  if (totalBytes > MAXIMUM_PRODUCTION_OUTPUT_BYTES) {
    fail(
      `Production output is ${totalBytes} bytes; budget is ${MAXIMUM_PRODUCTION_OUTPUT_BYTES}.`,
    )
  }
  return { manifest, ...active, files, totalBytes }
}

export function verifyTrackedAssetAllowlist() {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'public'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  const unexpected = tracked.filter((file) => {
    if (file.startsWith('public/media/')) {
      return !allowedTrackedMediaFiles.has(file)
    }
    if (file.startsWith('public/replays/')) {
      return file !== 'public/replays/2024-montreal-q-d63-lap22.json'
    }
    if (file.startsWith('public/basis/')) {
      return !allowedTrackedBasisFiles.has(file)
    }
    return false
  })
  if (unexpected.length > 0) {
    fail(`Tracked public assets exceed the release allowlist: ${unexpected.join(', ')}`)
  }

  const requiredTracked = new Set([
    ...[...requiredRuntimeOutputs].map((output) => `public/${output}`),
    'public/basis/LICENSE',
    'public/basis/basis_transcoder.js',
    'public/basis/basis_transcoder.wasm',
  ])
  const missing = exactSetDifference(requiredTracked, new Set(tracked))
  if (missing.length > 0) {
    fail(`Required release assets are not tracked: ${missing.join(', ')}`)
  }
  return tracked
}

async function runCli() {
  const command = process.argv[2]
  if (command === 'manifest') {
    const manifest = await loadManifest()
    console.log(
      `[release-assets] Manifest ${manifest.releaseId} allows ${manifest.assets.length} files.`,
    )
    return
  }
  if (command === 'verify') {
    const result = await verifyRuntimeAssets()
    console.log(
      `[release-assets] Verified ${result.assets.length} local files for ${result.manifest.releaseId}` +
        `${result.assetBaseUrl ? ` (runtime base: ${result.assetBaseUrl}).` : '.'}`,
    )
    return
  }
  if (command === 'git') {
    const tracked = verifyTrackedAssetAllowlist()
    console.log(`[release-assets] Tracked public allowlist is clean (${tracked.length} files).`)
    return
  }
  if (command === 'stage') {
    const result = await stageProductionPublic()
    console.log(
      `[release-assets] Staged ${result.assets.length} allowlisted files in .release/public.`,
    )
    return
  }
  if (command === 'not-found') {
    const result = await generateNotFoundDocument()
    console.log(
      `[release-assets] Generated branded 404.html from index.html (${result.bytes} bytes).`,
    )
    return
  }
  if (command === 'output') {
    const result = await verifyProductionOutput()
    console.log(
      `[release-assets] Verified ${result.files.length} production files (${result.totalBytes} bytes).`,
    )
    return
  }
  fail('Usage: runtime-assets.mjs <manifest|verify|git|stage|not-found|output>')
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
