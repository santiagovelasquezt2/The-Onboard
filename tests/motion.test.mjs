import assert from 'node:assert/strict'
import test from 'node:test'
import { criticallyDampedStep } from '../src/criticalDamping.ts'
import { advancePlaybackClock, createPlaybackClock } from '../src/playbackClock.ts'

test('the critically damped pose filter stays bounded through a dropped frame', () => {
  let value = 0
  let velocity = 0
  let previousValue = value

  for (let frame = 0; frame < 12; frame += 1) {
    const next = criticallyDampedStep(value, 10, velocity, 0.05, 0.028)
    value = next.value
    velocity = next.velocity
    assert.ok(Number.isFinite(value))
    assert.ok(Number.isFinite(velocity))
    assert.ok(value >= previousValue - 1e-9)
    assert.ok(value <= 10 + 1e-9)
    previousValue = value
  }

  assert.ok(value > 9.99)
})

test('the critically damped pose filter converges without overshooting on a long frame', () => {
  const next = criticallyDampedStep(0, 10, 0, 0.32, 0.028)
  assert.ok(Number.isFinite(next.value))
  assert.ok(Number.isFinite(next.velocity))
  assert.ok(next.value >= 0)
  assert.ok(next.value <= 10)
  assert.ok(next.value > 9.99)
})

test('a media decode stall does not become a synthetic replay seek', () => {
  const clock = createPlaybackClock()
  advancePlaybackClock(clock, {
    videoLapTimeSeconds: 1,
    isPlaying: false,
  })

  let previousLapTime = clock.lapTimeSeconds
  for (let frame = 0; frame < 12; frame += 1) {
    const lapTime = advancePlaybackClock(clock, {
      videoLapTimeSeconds: 1,
      isPlaying: true,
    })
    assert.equal(lapTime, previousLapTime)
    assert.equal(clock.didSeek, false)
  }

  const resumedLapTime = advancePlaybackClock(clock, {
    videoLapTimeSeconds: 1.35,
    isPlaying: true,
  })
  assert.ok(resumedLapTime > previousLapTime)
  assert.equal(resumedLapTime, 1.35)
  assert.equal(clock.didSeek, false)
})

test('a long render frame remains a normal media advance, not a seek', () => {
  const clock = createPlaybackClock()
  advancePlaybackClock(clock, {
    videoLapTimeSeconds: 1,
    isPlaying: false,
  })

  const lapTime = advancePlaybackClock(clock, {
    videoLapTimeSeconds: 1.32,
    isPlaying: true,
  })
  assert.equal(lapTime, 1.32)
  assert.equal(clock.didSeek, false)
})

test('an intentional scrub still snaps the replay clock immediately', () => {
  const clock = createPlaybackClock()
  advancePlaybackClock(clock, {
    videoLapTimeSeconds: 1,
    isPlaying: false,
  })

  const lapTime = advancePlaybackClock(clock, {
    videoLapTimeSeconds: 42,
    isPlaying: false,
    explicitSeek: true,
  })
  assert.equal(lapTime, 42)
  assert.equal(clock.didSeek, true)
})
