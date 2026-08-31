/**
 * Runtime asset contract.
 *
 * Source media stays outside the application bundle. In development these
 * paths resolve against Vite's public directory. A production release can
 * point every immutable asset at one versioned origin with
 * `VITE_ASSET_BASE_URL`.
 */

export const RUNTIME_ASSET_PATHS = {
  replay: 'replays/2024-montreal-q-d63-lap22.json',
  trackModel: 'media/track/montreal-runtime-v2.glb',
  carModel: 'media/car/amg-w14-runtime-v2.glb',
  helmetModel:
    'media/helmet/russell-glass-shell.glb?v=shiny-black-visor-v3',
  basisTranscoder: 'basis/',
  onboardVideo: 'media/onboard.mp4?v=20260821',
  landingReels: [
    'media/landing/reel1.mp4',
    'media/landing/reel2.mp4',
    'media/landing/reel3.mp4',
  ],
} as const

export type RuntimeAssetEnvironment = {
  DEV?: boolean
  VITE_ASSET_BASE_URL?: string
  VITE_ONBOARD_VIDEO_URL?: string
  VITE_LANDING_REEL_1_URL?: string
  VITE_LANDING_REEL_2_URL?: string
  VITE_LANDING_REEL_3_URL?: string
  VITE_REPLAY_SHA256?: string
}

export type RuntimeAssetConfig = {
  /** Normalized release origin/prefix, or null for same-origin assets. */
  baseUrl: string | null
  replay: {
    url: string
    /** Optional raw-response checksum enforced before JSON parsing. */
    sha256: string | null
  }
  trackModelUrl: string
  carModelUrl: string
  helmetModelUrl: string
  /** Must retain its trailing slash for KTX2Loader's file-name appends. */
  basisTranscoderPath: string
  /** Bundled release footage, or an explicit set of hosted overrides. */
  landingReelUrls: readonly [string, string, string]
  /** Bundled release footage, or an explicit hosted override. */
  onboardVideoUrl: string
}

function configurationError(variable: string, detail: string): Error {
  return new Error(`[runtime-assets] ${variable} ${detail}`)
}

function normalizedOptionalValue(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeAssetBaseUrl(value: string | undefined): string | null {
  const normalized = normalizedOptionalValue(value)
  if (!normalized) return null

  if (normalized.startsWith('//')) {
    throw configurationError(
      'VITE_ASSET_BASE_URL',
      'must not use a protocol-relative URL.',
    )
  }
  if (normalized.startsWith('/')) {
    const [path, suffix] = normalized.split(/(?=[?#])/u, 2)
    if (suffix) {
      throw configurationError(
        'VITE_ASSET_BASE_URL',
        'must not include a query string or fragment.',
      )
    }
    return path === '/' ? '' : path.replace(/\/+$/u, '')
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw configurationError(
      'VITE_ASSET_BASE_URL',
      'must be an absolute http(s) URL or a root-relative path.',
    )
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw configurationError(
      'VITE_ASSET_BASE_URL',
      'must use http(s) and must not contain credentials.',
    )
  }
  if (parsed.search || parsed.hash) {
    throw configurationError(
      'VITE_ASSET_BASE_URL',
      'must not include a query string or fragment.',
    )
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
  return parsed.toString().replace(/\/$/u, '')
}

function normalizeStandaloneAssetUrl(
  variable: string,
  value: string | undefined,
): string | null {
  const normalized = normalizedOptionalValue(value)
  if (!normalized) return null
  if (normalized.startsWith('//')) {
    throw configurationError(variable, 'must not use a protocol-relative URL.')
  }
  if (normalized.startsWith('/')) return normalized

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw configurationError(
      variable,
      'must be an absolute http(s) URL or a root-relative path.',
    )
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw configurationError(
      variable,
      'must use http(s) and must not contain credentials.',
    )
  }
  return parsed.toString()
}

function normalizeSha256(value: string | undefined): string | null {
  const normalized = normalizedOptionalValue(value)?.toLowerCase() ?? null
  if (!normalized) return null
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw configurationError(
      'VITE_REPLAY_SHA256',
      'must be a 64-character hexadecimal SHA-256 digest.',
    )
  }
  return normalized
}

export function runtimeAssetUrl(path: string, baseUrl: string | null): string {
  const relativePath = path.replace(/^\/+/, '')
  return baseUrl === null || baseUrl === ''
    ? `/${relativePath}`
    : `${baseUrl}/${relativePath}`
}

export function createRuntimeAssetConfig(
  environment: RuntimeAssetEnvironment,
): RuntimeAssetConfig {
  const baseUrl = normalizeAssetBaseUrl(environment.VITE_ASSET_BASE_URL)
  const resolve = (path: string) => runtimeAssetUrl(path, baseUrl)
  const explicitOnboardUrl = normalizeStandaloneAssetUrl(
    'VITE_ONBOARD_VIDEO_URL',
    environment.VITE_ONBOARD_VIDEO_URL,
  )
  const explicitLandingReelUrls = [
    normalizeStandaloneAssetUrl(
      'VITE_LANDING_REEL_1_URL',
      environment.VITE_LANDING_REEL_1_URL,
    ),
    normalizeStandaloneAssetUrl(
      'VITE_LANDING_REEL_2_URL',
      environment.VITE_LANDING_REEL_2_URL,
    ),
    normalizeStandaloneAssetUrl(
      'VITE_LANDING_REEL_3_URL',
      environment.VITE_LANDING_REEL_3_URL,
    ),
  ] as const
  const explicitLandingReelCount = explicitLandingReelUrls.filter(Boolean).length
  if (explicitLandingReelCount > 0 && explicitLandingReelCount < 3) {
    throw configurationError(
      'VITE_LANDING_REEL_*_URL',
      'must configure all three reel URLs together.',
    )
  }
  const landingReelUrls =
    explicitLandingReelCount === 3
      ? (explicitLandingReelUrls as [string, string, string])
      : (RUNTIME_ASSET_PATHS.landingReels.map(resolve) as [
          string,
          string,
          string,
        ])

  return {
    baseUrl,
    replay: {
      url: resolve(RUNTIME_ASSET_PATHS.replay),
      sha256: normalizeSha256(environment.VITE_REPLAY_SHA256),
    },
    trackModelUrl: resolve(RUNTIME_ASSET_PATHS.trackModel),
    carModelUrl: resolve(RUNTIME_ASSET_PATHS.carModel),
    helmetModelUrl: resolve(RUNTIME_ASSET_PATHS.helmetModel),
    basisTranscoderPath: resolve(RUNTIME_ASSET_PATHS.basisTranscoder),
    landingReelUrls,
    onboardVideoUrl: explicitOnboardUrl ?? resolve(RUNTIME_ASSET_PATHS.onboardVideo),
  }
}

const runtimeEnvironment = (
  import.meta as ImportMeta & { env?: RuntimeAssetEnvironment }
).env

export const RUNTIME_ASSETS = createRuntimeAssetConfig({
  DEV: runtimeEnvironment?.DEV,
  VITE_ASSET_BASE_URL: runtimeEnvironment?.VITE_ASSET_BASE_URL,
  VITE_ONBOARD_VIDEO_URL: runtimeEnvironment?.VITE_ONBOARD_VIDEO_URL,
  VITE_LANDING_REEL_1_URL: runtimeEnvironment?.VITE_LANDING_REEL_1_URL,
  VITE_LANDING_REEL_2_URL: runtimeEnvironment?.VITE_LANDING_REEL_2_URL,
  VITE_LANDING_REEL_3_URL: runtimeEnvironment?.VITE_LANDING_REEL_3_URL,
  VITE_REPLAY_SHA256: runtimeEnvironment?.VITE_REPLAY_SHA256,
})
