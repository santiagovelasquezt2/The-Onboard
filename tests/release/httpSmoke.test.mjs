import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  REQUIRED_NOT_FOUND_ROUTES,
  assertWebManifestLink,
  verifyNotFoundRoute,
} from '../../scripts/release/http-smoke.mjs'

const appBaseUrl = new URL('https://preview.example/')
const appShell = `<!doctype html>
<html><head><link rel="manifest" href="/site.webmanifest"></head><body><div id="root"></div><script type="module" src="/assets/index-release.js"></script></body></html>`

function response(status, contentType = 'text/html', body = appShell) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'content-security-policy': "default-src 'self'; connect-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:",
      'permissions-policy': 'camera=()',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  })
}

test('hosted smoke covers the internal lab and an unrecognized canary route', () => {
  assert.deepEqual(REQUIRED_NOT_FOUND_ROUTES, [
    '/driving-line-lab',
    '/not-a-route',
  ])
})

test('production HTML must link the release web manifest', () => {
  assert.doesNotThrow(() => assertWebManifestLink(appShell))
  assert.throws(
    () => assertWebManifestLink('<html><head></head><body></body></html>'),
    /does not link \/site\.webmanifest/,
  )
})

test('a real 404 with the branded React app shell passes', async () => {
  await assert.doesNotReject(
    verifyNotFoundRoute(
      appBaseUrl,
      '/not-a-route',
      async () => response(404),
    ),
  )
})

test('an SPA HTML 200 fallback fails negative-route smoke', async () => {
  await assert.rejects(
    verifyNotFoundRoute(
      appBaseUrl,
      '/not-a-route',
      async () => response(200),
    ),
    /expected a real HTTP 404, not an SPA HTML 200 fallback/,
  )
})

test('a generic text 404 fails the branded fallback check', async () => {
  await assert.rejects(
    verifyNotFoundRoute(
      appBaseUrl,
      '/driving-line-lab',
      async () => response(404, 'text/plain', 'Not Found'),
    ),
    /expected the branded HTML app shell/,
  )
})

test('negative-route smoke rejects a CSP without blob in connect-src', async () => {
  const missingBlob = response(404)
  missingBlob.headers.set(
    'content-security-policy',
    "default-src 'self'; connect-src 'self' https:; img-src blob:; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:",
  )
  await assert.rejects(
    verifyNotFoundRoute(
      appBaseUrl,
      '/not-a-route',
      async () => missingBlob,
    ),
    /must allow blob: in connect-src/,
  )
})

test('hosted smoke rejects a CSP that strands the Basis worker at parse time', async () => {
  const missingEval = response(404)
  missingEval.headers.set(
    'content-security-policy',
    "default-src 'self'; connect-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:",
  )
  await assert.rejects(
    verifyNotFoundRoute(
      appBaseUrl,
      '/not-a-route',
      async () => missingEval,
    ),
    /must allow 'unsafe-eval' in script-src for the self-hosted Basis transcoder/,
  )
})
