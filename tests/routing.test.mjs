import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAppMode } from '../src/routing.ts'

test('public app routes resolve explicitly from the pathname', () => {
  assert.equal(resolveAppMode('/'), 'hero')
  assert.equal(resolveAppMode('///'), 'hero')
  assert.equal(resolveAppMode('/hero'), 'hero')
  assert.equal(resolveAppMode('/hero/'), 'hero')
  assert.equal(resolveAppMode('/replay'), 'replay')
  assert.equal(resolveAppMode('/replay/'), 'replay')
})

test('the driving-line lab is only routable when explicitly enabled', () => {
  assert.equal(resolveAppMode('/driving-line-lab'), 'not-found')
  assert.equal(
    resolveAppMode('/driving-line-lab/', {
      enableDrivingLineLab: true,
    }),
    'driving-line-lab',
  )
})

test('unknown and near-match paths resolve to not-found', () => {
  assert.equal(resolveAppMode('/anything-else'), 'not-found')
  assert.equal(resolveAppMode('/replay/session'), 'not-found')
  assert.equal(resolveAppMode('/Replay'), 'not-found')
  assert.equal(resolveAppMode('replay'), 'not-found')
})
