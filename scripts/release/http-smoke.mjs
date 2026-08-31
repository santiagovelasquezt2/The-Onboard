import { loadManifest } from './runtime-assets.mjs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_ROUTES = ['/', '/hero', '/replay']
export const REQUIRED_NOT_FOUND_ROUTES = [
  '/driving-line-lab',
  '/not-a-route',
]
const REQUIRED_HEADERS = new Map([
  [
    'content-security-policy',
    ['default-src', 'connect-src', 'frame-ancestors', 'object-src'],
  ],
  ['permissions-policy', []],
  ['referrer-policy', []],
  ['x-content-type-options', ['nosniff']],
  ['x-frame-options', ['deny']],
])

const APP_SHELL_SCRIPT_PATTERN =
  /(?:src|href)=["']([^"']*\/assets\/[^"']+\.js)["']/i

function fail(message) {
  throw new Error(`[release-smoke] ${message}`)
}

export function assertWebManifestLink(html, label = 'The production HTML') {
  const manifestLink = html.match(
    /<link\b[^>]*\brel=["'][^"']*\bmanifest\b[^"']*["'][^>]*>/i,
  )?.[0]
  if (
    !manifestLink ||
    !/\bhref=["']\/site\.webmanifest["']/i.test(manifestLink)
  ) {
    fail(`${label} does not link /site.webmanifest.`)
  }
}

function parseBaseUrl(value, label) {
  if (!value) fail(`${label} is required.`)
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`${label} must be an absolute URL.`)
  }
  const localHttp =
    process.env.SMOKE_ALLOW_HTTP === '1' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    fail(`${label} must use HTTPS (local HTTP requires SMOKE_ALLOW_HTTP=1).`)
  }
  if (url.username || url.password || url.search || url.hash) {
    fail(`${label} must not contain credentials, a query, or a hash.`)
  }
  url.pathname = url.pathname.replace(/\/?$/, '/')
  return url
}

async function fetchResponse(
  url,
  init = {},
  fetchImplementation = globalThis.fetch,
) {
  let response
  try {
    response = await fetchImplementation(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      ...init,
    })
  } catch (error) {
    fail(`${url.href} could not be reached: ${error instanceof Error ? error.message : error}`)
  }
  return response
}

async function request(url, init = {}) {
  const response = await fetchResponse(url, init)
  if (!response.ok) fail(`${url.href} returned HTTP ${response.status}.`)
  return response
}

function assertSecurityHeaders(response) {
  for (const [name, requiredValues] of REQUIRED_HEADERS) {
    const value = response.headers.get(name)
    if (!value) fail(`Missing ${name} on ${response.url}.`)
    const normalized = value.toLowerCase()
    for (const required of requiredValues) {
      if (!normalized.includes(required)) {
        fail(`${name} on ${response.url} does not contain ${required}.`)
      }
    }
  }

  const policy = response.headers.get('content-security-policy') ?? ''
  const connectSource = policy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => /^connect-src(?:\s|$)/i.test(directive))
  if (!connectSource || !/(?:^|\s)blob:(?:\s|$)/i.test(connectSource)) {
    fail(`content-security-policy on ${response.url} must allow blob: in connect-src.`)
  }

  const scriptSource = policy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => /^script-src(?:\s|$)/i.test(directive))
  if (
    !scriptSource ||
    !/(?:^|\s)'unsafe-eval'(?:\s|$)/i.test(scriptSource)
  ) {
    fail(
      `content-security-policy on ${response.url} must allow 'unsafe-eval' in script-src for the self-hosted Basis transcoder.`,
    )
  }

  const workerSource = policy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => /^worker-src(?:\s|$)/i.test(directive))
  if (!workerSource || !/(?:^|\s)blob:(?:\s|$)/i.test(workerSource)) {
    fail(`content-security-policy on ${response.url} must allow blob: in worker-src.`)
  }
}

async function verifyRoute(appBaseUrl, route) {
  const url = new URL(route.replace(/^\//, ''), appBaseUrl)
  const response = await request(url)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) {
    fail(`${url.href} returned ${contentType || 'no content-type'}, expected HTML.`)
  }
  assertSecurityHeaders(response)
  const html = await response.text()
  assertWebManifestLink(html, url.href)
  return html
}

export async function verifyNotFoundRoute(
  appBaseUrl,
  route,
  fetchImplementation = globalThis.fetch,
) {
  const url = new URL(route.replace(/^\//, ''), appBaseUrl)
  const response = await fetchResponse(url, {}, fetchImplementation)
  if (response.status !== 404) {
    fail(
      `${url.href} returned HTTP ${response.status}; expected a real HTTP 404, not an SPA HTML 200 fallback.`,
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) {
    fail(
      `${url.href} returned HTTP 404 with ${contentType || 'no content-type'}; expected the branded HTML app shell.`,
    )
  }
  assertSecurityHeaders(response)

  const html = await response.text()
  if (!/<div\s+id=["']root["'][^>]*>/i.test(html)) {
    fail(`${url.href} HTTP 404 does not contain the React root.`)
  }
  if (!APP_SHELL_SCRIPT_PATTERN.test(html)) {
    fail(`${url.href} HTTP 404 does not reference the compiled app shell.`)
  }
  assertWebManifestLink(html, `${url.href} HTTP 404`)
  return html
}

async function verifyAsset(url, asset, requireLength) {
  const response = await request(url, {
    method: 'HEAD',
    headers: { 'accept-encoding': 'identity' },
  })
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) !== asset.bytes) {
    fail(`${url.href} has ${length} bytes; manifest expects ${asset.bytes}.`)
  }
  if (requireLength && length === null) {
    fail(`${url.href} did not return content-length.`)
  }
}

async function run() {
  const appBaseUrl = parseBaseUrl(process.env.SMOKE_BASE_URL, 'SMOKE_BASE_URL')
  const externalAssetBase = process.env.SMOKE_ASSET_BASE_URL
    ? parseBaseUrl(process.env.SMOKE_ASSET_BASE_URL, 'SMOKE_ASSET_BASE_URL')
    : null
  const manifest = await loadManifest()

  let rootHtml = ''
  for (const route of REQUIRED_ROUTES) {
    const html = await verifyRoute(appBaseUrl, route)
    if (route === '/') rootHtml = html
  }

  for (const route of REQUIRED_NOT_FOUND_ROUTES) {
    await verifyNotFoundRoute(appBaseUrl, route)
  }

  const scriptMatch = rootHtml.match(APP_SHELL_SCRIPT_PATTERN)
  if (!scriptMatch) fail('The production HTML does not reference a compiled JavaScript asset.')
  const scriptUrl = new URL(scriptMatch[1], appBaseUrl)
  const scriptResponse = await request(scriptUrl, { method: 'HEAD' })
  const scriptCache = scriptResponse.headers.get('cache-control')?.toLowerCase() ?? ''
  if (!scriptCache.includes('max-age=31536000') || !scriptCache.includes('immutable')) {
    fail(`${scriptUrl.href} is missing one-year immutable caching.`)
  }

  for (const asset of manifest.assets) {
    const base = asset.delivery === 'runtime' && externalAssetBase
      ? externalAssetBase
      : appBaseUrl
    await verifyAsset(new URL(asset.output, base), asset, base === appBaseUrl)
  }

  console.log(
    `[release-smoke] ${REQUIRED_ROUTES.length} routes, ${REQUIRED_NOT_FOUND_ROUTES.length} real 404s, and ${manifest.assets.length} release assets passed at ${appBaseUrl.href}`,
  )
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null
if (invokedPath === import.meta.url) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
