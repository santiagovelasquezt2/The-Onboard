import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '../..')
const BUILD_DIR = path.join(ROOT, 'tmp', 'asset-build')
const TRACK_BLEND_SOURCE = path.join(
  ROOT,
  'public',
  'media',
  'track',
  'montreal-track-working.blend',
)
const TRACK_BLEND_COPY = path.join(BUILD_DIR, 'montreal-runtime-working.blend')
const TRACK_SPATIAL_GLB = path.join(BUILD_DIR, 'montreal-spatial.glb')
const TRACK_KTX_GLB = path.join(BUILD_DIR, 'montreal-spatial-ktx.glb')
const TRACK_STAGED_GLB = path.join(BUILD_DIR, 'montreal-runtime-v2.glb')
const TRACK_OUTPUT = path.join(
  ROOT,
  'public',
  'media',
  'track',
  'montreal-runtime-v2.glb',
)
const CAR_SOURCE = path.join(
  ROOT,
  'public',
  'media',
  'car',
  'amg-w14.glb',
)
const CAR_KTX_GLB = path.join(BUILD_DIR, 'amg-w14-ktx.glb')
const CAR_STAGED_GLB = path.join(BUILD_DIR, 'amg-w14-runtime-v2.glb')
const CAR_OUTPUT = path.join(
  ROOT,
  'public',
  'media',
  'car',
  'amg-w14-runtime-v2.glb',
)

const KTX_VERSION = '4.4.2'
const KTX_DARWIN_ARM64_SHA256 =
  '500bd8f9d63358c3f3a0d83b724c8574436a72c37dc0e4bad90ec1ca38032c3c'
const KTX_PACKAGE_URL = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Darwin-arm64.pkg`

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      ...options,
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `${command} exited with ${code ?? `signal ${signal ?? 'unknown'}`}`,
        ),
      )
    })
  })
}

function commandPath(command) {
  const result = spawnSync('/usr/bin/which', [command], {
    encoding: 'utf8',
  })
  return result.status === 0 ? result.stdout.trim() : null
}

async function exists(filePath) {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

async function ensureKtxTools() {
  const configured = process.env.KTX_BIN_DIR
  if (
    configured &&
    (await exists(path.join(configured, 'ktx'))) &&
    (await exists(path.join(configured, 'toktx')))
  ) {
    return configured
  }

  const systemKtx = commandPath('ktx')
  const systemToktx = commandPath('toktx')
  if (systemKtx && systemToktx) return path.dirname(systemKtx)

  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      'KTX-Software 4.3+ is required. Install it or set KTX_BIN_DIR.',
    )
  }

  const toolingDir = path.join(ROOT, 'tmp', 'tooling')
  const packagePath = path.join(
    toolingDir,
    `KTX-Software-${KTX_VERSION}-Darwin-arm64.pkg`,
  )
  const expandedPath = path.join(toolingDir, `ktx-${KTX_VERSION}`)
  const toolsRoot = path.join(
    expandedPath,
    `KTX-Software-${KTX_VERSION}-Darwin-arm64-tools.pkg`,
    'Payload',
    'usr',
    'local',
  )
  const libraryRoot = path.join(
    expandedPath,
    `KTX-Software-${KTX_VERSION}-Darwin-arm64-library.pkg`,
    'Payload',
    'usr',
    'local',
    'lib',
  )
  const binDir = path.join(toolsRoot, 'bin')

  await mkdir(toolingDir, { recursive: true })
  if (
    !(await exists(packagePath)) ||
    (await sha256(packagePath)) !== KTX_DARWIN_ARM64_SHA256
  ) {
    console.log(`Downloading Khronos KTX-Software ${KTX_VERSION}…`)
    const response = await fetch(KTX_PACKAGE_URL)
    if (!response.ok) {
      throw new Error(`KTX-Software download failed: HTTP ${response.status}`)
    }
    await writeFile(packagePath, Buffer.from(await response.arrayBuffer()))
  }
  if ((await sha256(packagePath)) !== KTX_DARWIN_ARM64_SHA256) {
    throw new Error('KTX-Software package checksum mismatch')
  }

  if (!(await exists(path.join(binDir, 'toktx')))) {
    await rm(expandedPath, { recursive: true, force: true })
    await run('pkgutil', ['--expand-full', packagePath, expandedPath])
  }

  const localLibraryDir = path.join(toolsRoot, 'lib')
  await mkdir(localLibraryDir, { recursive: true })
  const versionedLibrary = `libktx.${KTX_VERSION}.dylib`
  await rm(path.join(localLibraryDir, versionedLibrary), { force: true })
  await rm(path.join(localLibraryDir, 'libktx.4.dylib'), { force: true })
  await rm(path.join(localLibraryDir, 'libktx.dylib'), { force: true })
  await symlink(
    path.join(libraryRoot, versionedLibrary),
    path.join(localLibraryDir, versionedLibrary),
  )
  await symlink(versionedLibrary, path.join(localLibraryDir, 'libktx.4.dylib'))
  await symlink('libktx.4.dylib', path.join(localLibraryDir, 'libktx.dylib'))
  await chmod(path.join(binDir, 'ktx'), 0o755)
  await chmod(path.join(binDir, 'toktx'), 0o755)
  return binDir
}

async function blenderPath() {
  const candidates = [
    process.env.BLENDER_BIN,
    commandPath('blender'),
    '/Applications/Blender 5.1.app/Contents/MacOS/Blender',
    '/Applications/Blender.app/Contents/MacOS/Blender',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  throw new Error('Blender is required; set BLENDER_BIN to its executable.')
}

async function compressAsset(input, ktxIntermediate, output, environment) {
  const localCli = path.join(ROOT, 'node_modules', '.bin', 'gltf-transform')
  const hasLocalCli = await exists(localCli)
  const gltfTransform = hasLocalCli ? localCli : 'npx'
  const cliPrefix = hasLocalCli
    ? []
    : ['--yes', `@gltf-transform/cli@${KTX_VERSION}`]
  await run(
    gltfTransform,
    [
      ...cliPrefix,
      'uastc',
      input,
      ktxIntermediate,
      '--level',
      '4',
      '--zstd',
      '18',
      '--jobs',
      '4',
      '--mipmaps',
      'true',
    ],
    { env: environment },
  )
  await run(gltfTransform, [
    ...cliPrefix,
    'meshopt',
    ktxIntermediate,
    output,
    '--level',
    'high',
    '--quantization-volume',
    'mesh',
    '--quantize-position',
    '16',
    '--quantize-normal',
    '12',
    '--quantize-texcoord',
    '14',
  ])
  await run(gltfTransform, [...cliPrefix, 'validate', output])
}

function glbMetadata(buffer) {
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(
    buffer
      .subarray(20, 20 + jsonLength)
      .toString('utf8')
      .replace(/\0+$/g, ''),
  )
  const triangleCount =
    json.meshes?.reduce(
      (meshTotal, mesh) =>
        meshTotal +
        (mesh.primitives?.reduce((primitiveTotal, primitive) => {
          if ((primitive.mode ?? 4) !== 4) return primitiveTotal
          const accessorIndex =
            primitive.indices ?? primitive.attributes?.POSITION
          const elementCount = json.accessors?.[accessorIndex]?.count ?? 0
          return primitiveTotal + elementCount / 3
        }, 0) ?? 0),
      0,
    ) ?? 0
  return {
    nodes: json.nodes?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    primitives:
      json.meshes?.reduce(
        (total, mesh) => total + (mesh.primitives?.length ?? 0),
        0,
      ) ?? 0,
    triangles: triangleCount,
    materials: json.materials?.length ?? 0,
    images: json.images?.length ?? 0,
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
  }
}

async function describe(filePath) {
  const buffer = await readFile(filePath)
  return {
    path: path.relative(ROOT, filePath),
    bytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    ...glbMetadata(buffer),
  }
}

async function installAtomically(staged, destination) {
  const temporary = `${destination}.installing`
  await copyFile(staged, temporary)
  await rename(temporary, destination)
}

async function main() {
  await access(TRACK_BLEND_SOURCE)
  await access(CAR_SOURCE)
  await mkdir(BUILD_DIR, { recursive: true })

  const [blender, ktxBinDir] = await Promise.all([
    blenderPath(),
    ensureKtxTools(),
  ])
  const environment = {
    ...process.env,
    PATH: `${ktxBinDir}:${process.env.PATH ?? ''}`,
  }

  console.log('Building 250 m Montréal spatial tiles from an isolated .blend copy…')
  await copyFile(TRACK_BLEND_SOURCE, TRACK_BLEND_COPY)
  await rm(TRACK_SPATIAL_GLB, { force: true })
  await run(blender, [
    '--background',
    TRACK_BLEND_COPY,
    '--python',
    path.join(
      ROOT,
      'scripts',
      'blender',
      'track',
      'build_montreal_runtime.py',
    ),
    '--',
    '--output',
    TRACK_SPATIAL_GLB,
    '--tile-size',
    '250',
  ])
  if (!(await exists(TRACK_SPATIAL_GLB))) {
    throw new Error('Blender did not produce the spatial track GLB')
  }

  console.log('Compressing track textures and geometry…')
  await compressAsset(
    TRACK_SPATIAL_GLB,
    TRACK_KTX_GLB,
    TRACK_STAGED_GLB,
    environment,
  )
  console.log('Compressing car textures and geometry…')
  await compressAsset(CAR_SOURCE, CAR_KTX_GLB, CAR_STAGED_GLB, environment)

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      track: await describe(TRACK_SPATIAL_GLB),
      car: await describe(CAR_SOURCE),
    },
    runtime: {
      track: await describe(TRACK_STAGED_GLB),
      car: await describe(CAR_STAGED_GLB),
    },
  }
  for (const assetName of ['track', 'car']) {
    const source = report.source[assetName]
    const runtime = report.runtime[assetName]
    for (const field of ['triangles', 'materials', 'images']) {
      if (runtime[field] !== source[field]) {
        throw new Error(
          `${assetName} ${field} changed during compression: ${source[field]} -> ${runtime[field]}`,
        )
      }
    }
  }
  for (const asset of Object.values(report.runtime)) {
    if (!asset.extensionsRequired.includes('KHR_texture_basisu')) {
      throw new Error(`${asset.path} is missing required KTX2 textures`)
    }
    if (!asset.extensionsRequired.includes('EXT_meshopt_compression')) {
      throw new Error(`${asset.path} is missing required Meshopt geometry`)
    }
  }

  await installAtomically(TRACK_STAGED_GLB, TRACK_OUTPUT)
  await installAtomically(CAR_STAGED_GLB, CAR_OUTPUT)
  await writeFile(
    path.join(BUILD_DIR, 'asset-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
