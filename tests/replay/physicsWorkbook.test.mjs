import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createPhysicsWorkbook,
  physicsAt,
} from '../../src/features/replay/physicsWorkbook.ts'
import { telemetryAt } from '../../src/features/replay/telemetryWorkbook.ts'

const goldenReplayUrl = new URL(
  '../../public/replays/2024-montreal-q-d63-lap22.json',
  import.meta.url,
)
const goldenReplay = existsSync(goldenReplayUrl)
  ? JSON.parse(readFileSync(goldenReplayUrl, 'utf8'))
  : null

function goldenReplayTest(name, run) {
  test(
    name,
    { skip: goldenReplay === null ? 'local golden-lap cache unavailable' : false },
    () => {
      assert.ok(goldenReplay)
      run(goldenReplay)
    },
  )
}

function carSample(
  timeSeconds,
  speed,
  { throttle = 100, brake = 0 } = {},
) {
  return {
    date: '',
    t_ms: timeSeconds * 1_000,
    speed,
    rpm: 10_000,
    n_gear: 7,
    throttle,
    brake,
    drs: 0,
  }
}

function locationSample(timeSeconds, x, y) {
  return {
    date: '',
    t_ms: timeSeconds * 1_000,
    x,
    y,
    z: 0,
  }
}

function straightReplay(durationSeconds, speedKph) {
  const speedMetersPerSecond = speedKph / 3.6
  return {
    lap: { lap_duration: durationSeconds },
    car_data: Array.from({ length: durationSeconds * 2 + 1 }, (_, index) => {
      const time = index / 2
      return carSample(time, speedKph)
    }),
    location: Array.from(
      { length: durationSeconds * 2 + 1 },
      (_, index) => {
        const time = index / 2
        return locationSample(time, speedMetersPerSecond * time, 0)
      },
    ),
  }
}

function circularReplay({
  durationSeconds = 8,
  radiusMeters = 100,
  speedKph = 72,
  direction = 1,
} = {}) {
  const speedMetersPerSecond = speedKph / 3.6
  const angularSpeed = speedMetersPerSecond / radiusMeters
  const times = Array.from(
    { length: durationSeconds * 10 + 1 },
    (_, index) => index / 10,
  )
  return {
    lap: { lap_duration: durationSeconds },
    car_data: times.map((time) => carSample(time, speedKph, { throttle: 45 })),
    location: times.map((time) => {
      const angle = direction * angularSpeed * time
      return locationSample(
        time,
        radiusMeters * Math.cos(angle),
        radiusMeters * Math.sin(angle),
      )
    }),
  }
}

test('constant-speed straight stays at zero G without inventing a radius', () => {
  const workbook = createPhysicsWorkbook(straightReplay(10, 180))
  const reading = physicsAt(workbook, 5)

  assert.equal(reading.status, 'active')
  assert.equal(reading.speedKph, 180)
  assert.ok(Math.abs(reading.longitudinalG) < 1e-10)
  assert.ok(Math.abs(reading.lateralG) < 1e-10)
  assert.ok(Math.abs(reading.combinedG) < 1e-10)
  assert.equal(reading.turnRadiusMeters, null)
  assert.equal(reading.turnDirection, 'straight')
  assert.equal(reading.moment, 'full-throttle')
})

test('time-aware speed derivative reports sustained braking', () => {
  const durationSeconds = 4
  const carData = Array.from({ length: 17 }, (_, index) => {
    const time = index / 4
    return carSample(time, 200 - 25 * time, { throttle: 0, brake: 100 })
  })
  const workbook = createPhysicsWorkbook({
    lap: { lap_duration: durationSeconds },
    car_data: carData,
    location: Array.from({ length: 17 }, (_, index) => {
      const time = index / 4
      const distance = (200 / 3.6) * time - (25 / 3.6) * time * time * 0.5
      return locationSample(time, distance, 0)
    }),
  })
  const reading = physicsAt(workbook, 2)
  const expectedG = -(25 / 3.6) / 9.80665

  assert.equal(reading.status, 'active')
  assert.ok(Math.abs(reading.longitudinalG - expectedG) < 0.04)
  assert.equal(reading.moment, 'braking')
  assert.ok(workbook.lapReference.longitudinalG.minimum < -0.6)
})

test('circular path produces signed lateral G and turn direction', () => {
  // The Montreal OpenF1-to-rendered-track transform flips handedness.
  const leftWorkbook = createPhysicsWorkbook(
    circularReplay({ direction: -1, speedKph: 108 }),
  )
  const rightWorkbook = createPhysicsWorkbook(
    circularReplay({ direction: 1, speedKph: 108 }),
  )
  const left = physicsAt(leftWorkbook, 4)
  const right = physicsAt(rightWorkbook, 4)
  const expectedLateralG = (30 * 30) / 100 / 9.80665

  assert.equal(left.status, 'active')
  assert.equal(right.status, 'active')
  assert.equal(left.turnDirection, 'left')
  assert.equal(right.turnDirection, 'right')
  assert.ok(Math.abs(left.lateralG - expectedLateralG) < 0.06)
  assert.ok(Math.abs(right.lateralG + expectedLateralG) < 0.06)
  assert.ok(Math.abs(left.turnRadiusMeters - 100) < 12)
  assert.equal(left.moment, 'apex')
  assert.equal(leftWorkbook.channels.lateralG.provenance, 'estimated')
  assert.equal(leftWorkbook.channels.lateralG.confidence, 'medium')
})

test('irregular sparse packets remain finite and do not create a lap-seam spike', () => {
  const replay = circularReplay({
    durationSeconds: 12,
    radiusMeters: 80,
    speedKph: 54,
  })
  replay.car_data = replay.car_data.filter(
    (_, index) => ![3, 4, 17, 29, 30, 31, 65].includes(index),
  )
  replay.location = replay.location.filter(
    (_, index) => ![2, 3, 15, 33, 34, 70, 71].includes(index),
  )
  replay.car_data.splice(2, 0, { ...replay.car_data[1] })
  replay.location.push({ ...replay.location.at(-1), x: Number.NaN })

  const workbook = createPhysicsWorkbook(replay)
  assert.ok(workbook.timeline.length > 0)
  for (const sample of workbook.timeline) {
    for (const value of [
      sample.speedKph,
      sample.longitudinalG,
      sample.lateralG,
      sample.combinedG,
      sample.turnRadiusMeters,
    ]) {
      if (value !== null) assert.ok(Number.isFinite(value))
    }
  }

  const first = workbook.timeline[0]
  const last = workbook.timeline.at(-1)
  assert.equal(first.lateralG, null)
  assert.equal(last.lateralG, null)
})

test('phase logic distinguishes entry, apex, exit, and full-throttle straight', () => {
  const corner = circularReplay({
    durationSeconds: 8,
    radiusMeters: 40,
    speedKph: 108,
  })
  corner.car_data = corner.car_data.map((sample) => {
    const time = sample.t_ms / 1_000
    if (time < 2.5) {
      return { ...sample, speed: 108 - time * 3, throttle: 20, brake: 100 }
    }
    if (time > 5) {
      return { ...sample, speed: 100 + (time - 5) * 8, throttle: 80, brake: 0 }
    }
    return { ...sample, speed: 100, throttle: 40, brake: 0 }
  })
  const workbook = createPhysicsWorkbook(corner)

  assert.equal(physicsAt(workbook, 2).moment, 'corner-entry')
  assert.equal(physicsAt(workbook, 4).moment, 'apex')
  assert.equal(physicsAt(workbook, 6).moment, 'corner-exit')
  assert.equal(
    physicsAt(createPhysicsWorkbook(straightReplay(10, 180)), 5).moment,
    'full-throttle',
  )
})

test('pre-lap, lap end, and unavailable inputs return explicit boundary states', () => {
  const workbook = createPhysicsWorkbook(straightReplay(10, 180))
  assert.equal(physicsAt(workbook, -0.01).status, 'pre-lap')
  assert.equal(physicsAt(workbook, 10).status, 'complete')

  const unavailable = createPhysicsWorkbook({ car_data: [], location: [] })
  assert.equal(physicsAt(unavailable, 1).status, 'unavailable')
})

goldenReplayTest('golden lap bridges normal packet dropouts and stays live across the lap seam', (replay) => {
  const workbook = createPhysicsWorkbook(replay)
  const start = physicsAt(workbook, 0)
  const finish = physicsAt(workbook, 71.95)
  const casinoStraight = physicsAt(workbook, 55)

  for (const reading of [start, finish]) {
    assert.equal(reading.status, 'active')
    assert.ok(Number.isFinite(reading.longitudinalG))
    assert.ok(Number.isFinite(reading.lateralG))
    assert.ok(Number.isFinite(reading.combinedG))
  }
  assert.equal(casinoStraight.turnDirection, 'straight')

  const largeCarGaps = replay.car_data
    .slice(1)
    .map((sample, index) => [replay.car_data[index].t_ms, sample.t_ms])
    .filter(([lower, upper]) => upper - lower > 700)
  const largeLocationGaps = replay.location
    .slice(1)
    .map((sample, index) => [replay.location[index].t_ms, sample.t_ms])
    .filter(([lower, upper]) => upper - lower > 700)

  assert.ok(largeCarGaps.length >= 2)
  assert.ok(largeLocationGaps.length >= 2)
  for (const [lower, upper] of largeCarGaps) {
    const reading = physicsAt(workbook, (lower + upper) / 2_000)
    assert.ok(Number.isFinite(reading.longitudinalG))
    assert.ok(Number.isFinite(reading.combinedG))
  }
  for (const [lower, upper] of largeLocationGaps) {
    const reading = physicsAt(workbook, (lower + upper) / 2_000)
    assert.ok(Number.isFinite(reading.lateralG))
    assert.ok(Number.isFinite(reading.combinedG))
  }

  for (const sample of workbook.timeline) {
    assert.ok(Number.isFinite(sample.longitudinalG))
    assert.ok(Number.isFinite(sample.lateralG))
    assert.ok(Number.isFinite(sample.combinedG))
  }
})

test('a multi-second source outage remains unavailable rather than fabricated', () => {
  const replay = straightReplay(12, 180)
  replay.car_data = replay.car_data.filter(
    (sample) => sample.t_ms < 4_000 || sample.t_ms > 8_000,
  )
  replay.location = replay.location.filter(
    (sample) => sample.t_ms < 4_000 || sample.t_ms > 8_000,
  )

  const reading = physicsAt(createPhysicsWorkbook(replay), 6)
  assert.equal(reading.status, 'active')
  assert.equal(reading.longitudinalG, null)
  assert.equal(reading.lateralG, null)
  assert.equal(reading.combinedG, null)
})

goldenReplayTest('golden physics stays on the shared clock and preserves explicit boundaries', (replay) => {
  const workbook = createPhysicsWorkbook(replay)
  for (const timeSeconds of [0, 1.9, 3.6, 21.4, 34.4, 50.5, 55, 64.8]) {
    const physics = physicsAt(workbook, timeSeconds)
    const telemetry = telemetryAt(replay.car_data, timeSeconds)
    assert.ok(telemetry)
    assert.ok(Math.abs(physics.speedKph - telemetry.speed) < 1e-9)
  }

  assert.equal(physicsAt(workbook, -0.001).status, 'pre-lap')
  assert.equal(physicsAt(workbook, 72).status, 'complete')
  for (const sample of workbook.timeline) {
    for (const value of [sample.longitudinalG, sample.lateralG]) {
      if (value !== null) assert.ok(Math.abs(value) < 6)
    }
  }
})

goldenReplayTest('golden force ranges retain Montreal braking peaks without implausible spikes', (replay) => {
  const reference = createPhysicsWorkbook(replay).lapReference

  assert.ok(reference.longitudinalG.minimum < -4)
  assert.ok(reference.longitudinalG.minimum > -5.8)
  assert.ok(reference.longitudinalG.maximum > 0.8)
  assert.ok(reference.longitudinalG.maximum < 2.5)
  assert.ok(reference.lateralG.peakAbsolute > 3)
  assert.ok(reference.lateralG.peakAbsolute < 5.5)
  assert.ok(reference.combinedG.maximum > 4)
  assert.ok(reference.combinedG.maximum < 6)
})

goldenReplayTest('golden moment labels cover the lap and match audited checkpoints', (replay) => {
  const workbook = createPhysicsWorkbook(replay)
  const counts = new Map()
  for (const sample of workbook.timeline) {
    counts.set(sample.moment, (counts.get(sample.moment) ?? 0) + 1)
  }
  for (const moment of [
    'braking',
    'corner-entry',
    'apex',
    'corner-exit',
    'full-throttle',
    'straight',
  ]) {
    assert.ok((counts.get(moment) ?? 0) > 0, `${moment} should appear`)
  }
  assert.ok((counts.get('corner-exit') ?? 0) < workbook.timeline.length / 4)

  assert.equal(physicsAt(workbook, 1.9).moment, 'braking')
  assert.equal(physicsAt(workbook, 3.6).turnDirection, 'right')
  assert.equal(physicsAt(workbook, 5.6).turnDirection, 'left')
  assert.ok(physicsAt(workbook, 34.4).combinedG > 3)
  assert.equal(physicsAt(workbook, 44.3).moment, 'braking')
  assert.notEqual(physicsAt(workbook, 46.6).turnDirection, 'straight')
  assert.equal(physicsAt(workbook, 55).turnDirection, 'straight')
  assert.equal(physicsAt(workbook, 62.8).moment, 'braking')
  assert.equal(physicsAt(workbook, 64.2).turnDirection, 'left')
  assert.equal(physicsAt(workbook, 64.8).turnDirection, 'straight')
  assert.equal(physicsAt(workbook, 65.5).turnDirection, 'right')
})
