import assert from 'node:assert/strict'
import test from 'node:test'
import {
  drsPresentation,
  formatLapTime,
  telemetryAt,
  telemetryRanges,
  timingSectorAt,
} from '../../src/features/replay/telemetryWorkbook.ts'

const samples = [
  {
    date: '2024-06-08T20:52:06.351Z',
    t_ms: 200,
    speed: 100,
    rpm: 5000,
    n_gear: 2,
    throttle: 0,
    brake: 100,
    drs: 8,
  },
  {
    date: '2024-06-08T20:52:07.151Z',
    t_ms: 1000,
    speed: 300,
    rpm: 12239,
    n_gear: 8,
    throttle: 100,
    brake: 0,
    drs: 12,
  },
]

test('telemetry stays empty during the video run-up', () => {
  assert.equal(telemetryAt(samples, -0.001), null)
  assert.equal(telemetryAt([], 1), null)
})

test('continuous channels interpolate while discrete channels use the nearest packet', () => {
  const early = telemetryAt(samples, 0.4)
  assert.ok(early)
  assert.equal(early.speed, 150)
  assert.equal(early.throttle, 25)
  assert.equal(early.n_gear, 2)
  assert.equal(early.brake, 100)
  assert.equal(early.drs, 8)

  const late = telemetryAt(samples, 0.8)
  assert.ok(late)
  assert.equal(late.speed, 250)
  assert.equal(late.n_gear, 8)
  assert.equal(late.brake, 0)
  assert.equal(late.drs, 12)
})

test('telemetry ranges preserve values above twelve thousand rpm', () => {
  const ranges = telemetryRanges(samples)
  assert.ok(ranges)
  assert.deepEqual(ranges.speed, { minimum: 100, maximum: 300 })
  assert.deepEqual(ranges.rpm, { minimum: 5000, maximum: 12239 })
  assert.equal(ranges.sampleRateHz, 1.25)
})

test('DRS codes remain explicit states rather than a fabricated percentage', () => {
  assert.deepEqual(drsPresentation(null), {
    label: 'Standby',
    state: 'standby',
  })
  assert.deepEqual(drsPresentation(8), { label: 'Ready', state: 'ready' })
  assert.deepEqual(drsPresentation(12), { label: 'Open', state: 'open' })
  assert.deepEqual(drsPresentation(0), { label: 'Closed', state: 'closed' })
})

test('lap clock and official timing sectors share the same boundaries', () => {
  const sectors = [20.123, 22.726, 29.151]
  assert.equal(formatLapTime(-5.2), '-0:05.200')
  assert.equal(formatLapTime(72), '1:12.000')
  assert.equal(timingSectorAt(-0.01, sectors, 72), 'Pre-lap')
  assert.equal(timingSectorAt(20, sectors, 72), 'S1')
  assert.equal(timingSectorAt(20.123, sectors, 72), 'S2')
  assert.equal(timingSectorAt(42.849, sectors, 72), 'S3')
  assert.equal(timingSectorAt(72, sectors, 72), 'Complete')
})
