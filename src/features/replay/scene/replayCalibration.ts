import type { ReplayLocationSample } from '../replay'

/** Similarity fit from OpenF1's session plane to the Montreal GLB X/Z plane. */
const SCALE = 0.10058321
const ROTATION = 0.02196835
const TRANSLATION_X = -111.1014
const TRANSLATION_Z = 717.4031

const COS = Math.cos(ROTATION)
const SIN = Math.sin(ROTATION)

export function openF1ToTrackPlane(
  sample: Pick<ReplayLocationSample, 'x' | 'y'>,
) {
  return {
    x: TRANSLATION_X + SCALE * (COS * sample.x + SIN * sample.y),
    z: TRANSLATION_Z + SCALE * (SIN * sample.x - COS * sample.y),
  }
}

function upperSampleIndex(samples: ReplayLocationSample[], tMs: number) {
  let lower = 1
  let upper = samples.length - 1
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (samples[middle].t_ms < tMs) lower = middle + 1
    else upper = middle
  }
  return lower
}

export function interpolateLocation(
  samples: ReplayLocationSample[],
  tMs: number,
  durationMs?: number,
): ReplayLocationSample | null {
  if (samples.length === 0) return null
  if (samples.length === 1) return samples[0]

  const wraps =
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  const sampleTime = wraps
    ? ((tMs % durationMs) + durationMs) % durationMs
    : tMs
  const first = samples[0]
  const last = samples[samples.length - 1]

  let lower: ReplayLocationSample
  let upper: ReplayLocationSample
  let lowerTime: number
  let upperTime: number

  if (wraps && sampleTime < first.t_ms) {
    lower = last
    upper = first
    lowerTime = last.t_ms - durationMs
    upperTime = first.t_ms
  } else if (wraps && sampleTime > last.t_ms) {
    lower = last
    upper = first
    lowerTime = last.t_ms
    upperTime = first.t_ms + durationMs
  } else if (sampleTime <= first.t_ms) {
    lower = first
    upper = samples[1]
    lowerTime = lower.t_ms
    upperTime = upper.t_ms
  } else if (sampleTime >= last.t_ms) {
    lower = samples[samples.length - 2]
    upper = last
    lowerTime = lower.t_ms
    upperTime = upper.t_ms
  } else {
    const upperIndex = upperSampleIndex(samples, sampleTime)
    lower = samples[upperIndex - 1]
    upper = samples[upperIndex]
    lowerTime = lower.t_ms
    upperTime = upper.t_ms
  }

  const span = upperTime - lowerTime
  const alpha = span > 0 ? (sampleTime - lowerTime) / span : 0
  return {
    date: alpha < 0.5 ? lower.date : upper.date,
    t_ms: sampleTime,
    x: lower.x + (upper.x - lower.x) * alpha,
    y: lower.y + (upper.y - lower.y) * alpha,
    z: lower.z + (upper.z - lower.z) * alpha,
  }
}

type TimedLocationSample = {
  sample: ReplayLocationSample
  time: number
}

function periodicSampleAt(
  samples: ReplayLocationSample[],
  index: number,
  durationMs: number,
): TimedLocationSample {
  const count = samples.length
  const cycle = Math.floor(index / count)
  const wrappedIndex = ((index % count) + count) % count
  return {
    sample: samples[wrappedIndex],
    time: samples[wrappedIndex].t_ms + cycle * durationMs,
  }
}

function hermite(
  p0: number,
  p1: number,
  tangent0: number,
  tangent1: number,
  alpha: number,
  span: number,
) {
  const alpha2 = alpha * alpha
  const alpha3 = alpha2 * alpha
  return (
    (2 * alpha3 - 3 * alpha2 + 1) * p0 +
    (alpha3 - 2 * alpha2 + alpha) * span * tangent0 +
    (-2 * alpha3 + 3 * alpha2) * p1 +
    (alpha3 - alpha2) * span * tangent1
  )
}

/** C1 interpolation retained as the safe fallback when speed data is absent. */
export function interpolateSmoothedLocation(
  samples: ReplayLocationSample[],
  tMs: number,
  durationMs?: number,
): ReplayLocationSample | null {
  if (
    samples.length < 4 ||
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return interpolateLocation(samples, tMs, durationMs)
  }

  const sampleTime = ((tMs % durationMs) + durationMs) % durationMs
  const first = samples[0]
  const last = samples[samples.length - 1]
  let lowerIndex: number

  if (sampleTime < first.t_ms) lowerIndex = -1
  else if (sampleTime > last.t_ms) lowerIndex = samples.length - 1
  else lowerIndex = Math.max(0, upperSampleIndex(samples, sampleTime) - 1)

  const previous = periodicSampleAt(samples, lowerIndex - 1, durationMs)
  const lower = periodicSampleAt(samples, lowerIndex, durationMs)
  const upper = periodicSampleAt(samples, lowerIndex + 1, durationMs)
  const next = periodicSampleAt(samples, lowerIndex + 2, durationMs)
  const span = upper.time - lower.time
  const lowerTangentSpan = upper.time - previous.time
  const upperTangentSpan = next.time - lower.time
  if (span <= 0 || lowerTangentSpan <= 0 || upperTangentSpan <= 0) {
    return interpolateLocation(samples, sampleTime, durationMs)
  }

  const alpha = Math.min(1, Math.max(0, (sampleTime - lower.time) / span))
  const smooth = (key: 'x' | 'y' | 'z') =>
    hermite(
      lower.sample[key],
      upper.sample[key],
      (upper.sample[key] - previous.sample[key]) / lowerTangentSpan,
      (next.sample[key] - lower.sample[key]) / upperTangentSpan,
      alpha,
      span,
    )

  return {
    date: alpha < 0.5 ? lower.sample.date : upper.sample.date,
    t_ms: sampleTime,
    x: smooth('x'),
    y: smooth('y'),
    z: smooth('z'),
  }
}

/** Estimate a forward vector from the same location source as the position. */
export function interpolateHeading(
  samples: ReplayLocationSample[],
  tMs: number,
  durationMs?: number,
  smooth = false,
  windowMs = 120,
): { previous: ReplayLocationSample; next: ReplayLocationSample } | null {
  if (samples.length < 2) return null
  const interpolate = smooth
    ? interpolateSmoothedLocation
    : interpolateLocation
  const previous =
    interpolate(samples, tMs - windowMs, durationMs) ?? samples[0]
  const next =
    interpolate(samples, tMs + windowMs, durationMs) ?? samples[samples.length - 1]
  return { previous, next }
}
