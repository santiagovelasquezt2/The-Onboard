import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeReplayResponse,
  ReplayValidationError,
  validateReplayPayload,
} from '../../src/features/replay/replay.ts'

const lapStartMs = Date.parse('2024-06-08T20:52:06.151Z')

function sampleTime(index, count = 251) {
  return Math.round((index * 72_000) / (count - 1))
}

function replayFixture() {
  const car_data = Array.from({ length: 251 }, (_, index) => {
    const t_ms = sampleTime(index)
    return {
      date: new Date(lapStartMs + t_ms).toISOString(),
      t_ms,
      speed: 300,
      rpm: 11_000,
      n_gear: 8,
      throttle: 100,
      brake: 0,
      drs: 12,
    }
  })
  const location = Array.from({ length: 251 }, (_, index) => {
    const t_ms = sampleTime(index)
    return {
      date: new Date(lapStartMs + t_ms).toISOString(),
      t_ms,
      x: index * 2,
      y: 0,
      z: index * -3,
    }
  })

  return {
    schema_version: 1,
    source: 'openf1',
    pulled_at: '2026-08-21T20:39:19.352Z',
    session_key: 9527,
    meeting_key: 1237,
    circuit_short_name: 'Montreal',
    session_name: 'Qualifying',
    year: 2024,
    driver: {
      driver_number: 63,
      name_acronym: 'RUS',
      full_name: 'George RUSSELL',
      team_name: 'Mercedes',
    },
    lap: {
      lap_number: 22,
      lap_duration: 72,
      date_start: '2024-06-08T20:52:06.151Z',
    },
    car_data,
    location,
  }
}

test('the golden replay identity and sample coverage produce deterministic metadata', () => {
  const { replay, metadata } = validateReplayPayload(replayFixture())

  assert.equal(replay.session_key, 9527)
  assert.equal(metadata.provider, 'OpenF1')
  assert.equal(metadata.identity.driverNumber, 63)
  assert.deepEqual(metadata.samples.carData, {
    count: 251,
    firstTimeMs: 0,
    lastTimeMs: 72_000,
    maximumGapMs: 288,
  })
  assert.deepEqual(metadata.samples.location, metadata.samples.carData)
  assert.deepEqual(metadata.integrity, {
    algorithm: 'SHA-256',
    expectedSha256: null,
    actualSha256: null,
    verified: false,
  })
})

test('mock or wrong-lap data cannot enter the runtime replay', () => {
  const mock = replayFixture()
  mock.source = 'mock'
  assert.throws(
    () => validateReplayPayload(mock),
    /source must be openf1; received mock/u,
  )

  const wrongLap = replayFixture()
  wrongLap.lap.lap_number = 21
  assert.throws(
    () => validateReplayPayload(wrongLap),
    /lap\.lap_number must be 22/u,
  )
})

test('truncated, unsorted, and gapped streams fail before rendering', () => {
  const truncated = replayFixture()
  truncated.car_data = truncated.car_data.slice(0, 249)
  assert.throws(
    () => validateReplayPayload(truncated),
    /car_data requires at least 250 samples/u,
  )

  const unsorted = replayFixture()
  unsorted.location[120].t_ms = unsorted.location[119].t_ms
  assert.throws(
    () => validateReplayPayload(unsorted),
    /location timestamps must be strictly increasing/u,
  )

  const gapped = replayFixture()
  const gapStartMs = gapped.car_data[99].t_ms + 1_100
  for (let index = 100; index < gapped.car_data.length; index += 1) {
    const progress = (index - 100) / (gapped.car_data.length - 1 - 100)
    const t_ms = Math.round(gapStartMs + progress * (72_000 - gapStartMs))
    gapped.car_data[index].t_ms = t_ms
    gapped.car_data[index].date = new Date(lapStartMs + t_ms).toISOString()
  }
  assert.throws(
    () => validateReplayPayload(gapped),
    /car_data contains a 1100 ms source-data gap/u,
  )
})

test('raw replay bytes can be pinned to a release checksum', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(replayFixture()))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const expectedSha256 = Buffer.from(digest).toString('hex')

  const result = await decodeReplayResponse(bytes.buffer, expectedSha256)

  assert.equal(result.metadata.integrity.verified, true)
  assert.equal(result.metadata.integrity.actualSha256, expectedSha256)
  await assert.rejects(
    decodeReplayResponse(bytes.buffer, '0'.repeat(64)),
    ReplayValidationError,
  )
})

test('invalid JSON is reported as a replay validation failure', async () => {
  const bytes = new TextEncoder().encode('{not valid json')
  await assert.rejects(
    decodeReplayResponse(bytes.buffer),
    /Replay cache must contain valid JSON/u,
  )
})
