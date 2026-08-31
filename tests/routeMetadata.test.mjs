import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { routeMetadataFor } from '../src/routeMetadata.ts'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

test('public routes expose distinct titles and canonical paths', () => {
  assert.equal(routeMetadataFor('hero').canonicalPath, '/')
  assert.equal(routeMetadataFor('replay').canonicalPath, '/replay')
  assert.match(routeMetadataFor('replay').title, /Montreal pole lap/)
})

test('internal and missing routes are not indexable', () => {
  assert.equal(routeMetadataFor('not-found').indexable, false)
  assert.equal(routeMetadataFor('driving-line-lab').indexable, false)
})

test('the HTML shell exposes every selector used by route metadata', () => {
  assert.match(indexHtml, /<link\s+rel="canonical"/)
  assert.match(indexHtml, /<meta\s+name="description"/)
  assert.match(indexHtml, /<meta\s+name="robots"/)
  assert.match(indexHtml, /<meta\s+property="og:title"/)
  assert.match(indexHtml, /<meta\s+property="og:description"/)
  assert.match(indexHtml, /<meta\s+property="og:url"/)
  assert.match(indexHtml, /<meta\s+name="twitter:title"/)
  assert.match(indexHtml, /<meta\s+name="twitter:description"/)
})
