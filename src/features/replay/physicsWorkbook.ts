import type {
  ReplayCarSample,
  ReplayFile,
  ReplayLocationSample,
} from './replay'
import { AUDITED_CURB_CONTACTS } from './calibration/curbContacts.ts'

const STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665
const DEFAULT_SAMPLE_RATE_HZ = 20
// Keep enough filtering to suppress integer-speed packet noise without washing
// Montréal's real, short 4 G-plus braking events down into a generic 3 G curve.
const SPEED_SMOOTHING_SECONDS = 0.35
const ACCELERATION_WINDOW_SECONDS = 0.3
const POSITION_SMOOTHING_SECONDS = 0.65
const CURVATURE_SPAN_SECONDS = 0.55
const CURVATURE_SMOOTHING_SECONDS = 0.35
const MAX_ABSOLUTE_G = 6
const MIN_RADIUS_CURVATURE_PER_METER = 1 / 2_000
const MIN_DIRECTION_LATERAL_G = 0.08
// OpenF1 targets about 3.7 Hz, but occasional packets arrive roughly one second
// apart. Those are short dropouts inside an otherwise complete offline lap, not
// evidence that the car stopped producing force. Bridge up to roughly five
// normal packet intervals while still rejecting genuinely long outages.
const SAMPLE_GAP_MULTIPLIER = 5
const MIN_SAMPLE_GAP_LIMIT_MS = 800
const MAX_SAMPLE_GAP_LIMIT_MS = 1_500
const CORNER_ENTER_LATERAL_G = 0.75
const CORNER_EXIT_LATERAL_G = 0.55
const CORNER_MINIMUM_DWELL_SECONDS = 0.25
const MONTREAL_RENDERED_TURN_SIGN = -1

export type PhysicsStatus =
  | 'pre-lap'
  | 'active'
  | 'complete'
  | 'unavailable'

export type PhysicsMoment =
  | 'pre-lap'
  | 'braking'
  | 'corner-entry'
  | 'apex'
  | 'corner-exit'
  | 'full-throttle'
  | 'straight'
  | 'lap-complete'
  | 'unavailable'

export type PhysicsTurnDirection = 'left' | 'right' | 'straight'
export type PhysicsProvenance = 'recorded' | 'derived' | 'estimated'
export type PhysicsConfidence = 'high' | 'medium' | 'unavailable'

export type PhysicsChannelMetadata = {
  provenance: PhysicsProvenance
  confidence: PhysicsConfidence
  method: string
}

export type PhysicsChannelMetadataMap = {
  speedKph: PhysicsChannelMetadata
  longitudinalG: PhysicsChannelMetadata
  lateralG: PhysicsChannelMetadata
  combinedG: PhysicsChannelMetadata
  turnRadiusMeters: PhysicsChannelMetadata
}

export type PhysicsNumericRange = {
  minimum: number
  maximum: number
}

export type PhysicsSignedRange = PhysicsNumericRange & {
  peakAbsolute: number
}

export type PhysicsLapReference = {
  speedKph: PhysicsNumericRange | null
  longitudinalG: PhysicsSignedRange | null
  lateralG: PhysicsSignedRange | null
  combinedG: PhysicsNumericRange | null
}

export type PhysicsTimelineSample = {
  timeSeconds: number
  speedKph: number
  longitudinalG: number | null
  lateralG: number | null
  combinedG: number | null
  turnRadiusMeters: number | null
  turnDirection: PhysicsTurnDirection
  trackLabel: string
  moment: Exclude<
    PhysicsMoment,
    'pre-lap' | 'lap-complete' | 'unavailable'
  >
}

export type PhysicsWorkbook = {
  durationSeconds: number
  sampleRateHz: number
  timeline: readonly PhysicsTimelineSample[]
  channels: PhysicsChannelMetadataMap
  lapReference: PhysicsLapReference
  /** Geometry scale inferred by matching location-path length to speed integral. */
  locationScaleMetersPerUnit: number | null
}

type PhysicsBoundaryReading = {
  status: Exclude<PhysicsStatus, 'active'>
  timeSeconds: number
  speedKph: null
  longitudinalG: null
  lateralG: null
  combinedG: null
  turnRadiusMeters: null
  turnDirection: 'straight'
  trackLabel: string
  moment: Extract<
    PhysicsMoment,
    'pre-lap' | 'lap-complete' | 'unavailable'
  >
}

export type PhysicsActiveReading = PhysicsTimelineSample & {
  status: 'active'
}

export type PhysicsReading = PhysicsActiveReading | PhysicsBoundaryReading

export type PhysicsWorkbookInput = Pick<ReplayFile, 'car_data' | 'location'> & {
  lap?: Pick<ReplayFile['lap'], 'lap_duration'>
}

export type PhysicsWorkbookOptions = {
  durationSeconds?: number
  sampleRateHz?: number
}

type SanitizedCarSample = Pick<
  ReplayCarSample,
  't_ms' | 'speed' | 'throttle' | 'brake'
>

type SanitizedLocationSample = Pick<
  ReplayLocationSample,
  't_ms' | 'x' | 'y'
>

type Point = {
  x: number
  y: number
}

type MontrealSection = {
  label: string
  start: number
  end: number
}

const MONTREAL_REFERENCE_DURATION_SECONDS = 72
const MONTREAL_SECTIONS: readonly MontrealSection[] = [
  { label: 'Opening chicane · Turns 1–2', start: 0, end: 10 },
  { label: 'Turns 3–5', start: 10, end: 19 },
  { label: 'Turns 6–7', start: 19, end: 29 },
  { label: 'Run to Turns 8–9', start: 29, end: 33 },
  { label: 'Turns 8–9', start: 33, end: 40 },
  { label: 'Hairpin · Turn 10', start: 40, end: 52 },
  { label: 'Casino straight', start: 52, end: 63 },
  { label: 'Final chicane · Turns 13–14', start: 63, end: 68 },
  { label: 'Start/finish straight', start: 68, end: 72 },
]

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteOr(value: number | undefined | null, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeCarData(
  samples: readonly ReplayCarSample[],
): SanitizedCarSample[] {
  const sorted = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.t_ms) &&
        sample.t_ms >= 0 &&
        Number.isFinite(sample.speed) &&
        sample.speed >= 0,
    )
    .map((sample) => ({
      t_ms: sample.t_ms,
      speed: sample.speed,
      throttle: clamp(finiteOr(sample.throttle, 0), 0, 100),
      brake: finiteOr(sample.brake, 0),
    }))
    .sort((left, right) => left.t_ms - right.t_ms)

  const unique: SanitizedCarSample[] = []
  for (const sample of sorted) {
    if (unique.at(-1)?.t_ms === sample.t_ms) unique[unique.length - 1] = sample
    else unique.push(sample)
  }
  return unique
}

function sanitizeLocations(
  samples: readonly ReplayLocationSample[],
): SanitizedLocationSample[] {
  const sorted = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.t_ms) &&
        sample.t_ms >= 0 &&
        Number.isFinite(sample.x) &&
        Number.isFinite(sample.y),
    )
    .map((sample) => ({
      t_ms: sample.t_ms,
      x: sample.x,
      y: sample.y,
    }))
    .sort((left, right) => left.t_ms - right.t_ms)

  const unique: SanitizedLocationSample[] = []
  for (const sample of sorted) {
    if (unique.at(-1)?.t_ms === sample.t_ms) unique[unique.length - 1] = sample
    else unique.push(sample)
  }
  return unique
}

function upperTimeIndex<T extends { t_ms: number }>(
  samples: readonly T[],
  targetMs: number,
) {
  let low = 0
  let high = samples.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (samples[middle].t_ms < targetMs) low = middle + 1
    else high = middle
  }
  return low
}

function carValuesAt(samples: readonly SanitizedCarSample[], targetMs: number) {
  const first = samples[0]
  if (!first) return null
  if (samples.length === 1 || targetMs <= first.t_ms) return first

  const last = samples.at(-1)!
  if (targetMs >= last.t_ms) return last

  const upperIndex = upperTimeIndex(samples, targetMs)
  const lower = samples[upperIndex - 1]
  const upper = samples[upperIndex]
  const span = Math.max(1, upper.t_ms - lower.t_ms)
  const alpha = clamp((targetMs - lower.t_ms) / span, 0, 1)
  const nearest = alpha < 0.5 ? lower : upper

  return {
    t_ms: targetMs,
    speed: lower.speed + (upper.speed - lower.speed) * alpha,
    throttle: lower.throttle + (upper.throttle - lower.throttle) * alpha,
    brake: nearest.brake,
  }
}

function median(values: readonly number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle]
}

function sampleGapLimitMs<T extends { t_ms: number }>(samples: readonly T[]) {
  const gaps: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const gap = samples[index].t_ms - samples[index - 1].t_ms
    if (gap > 0) gaps.push(gap)
  }
  return clamp(
    median(gaps) * SAMPLE_GAP_MULTIPLIER,
    MIN_SAMPLE_GAP_LIMIT_MS,
    MAX_SAMPLE_GAP_LIMIT_MS,
  )
}

function sampleSeamIsContinuous<T extends { t_ms: number }>(
  samples: readonly T[],
  durationMs: number,
  gapLimitMs: number,
) {
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last || durationMs <= 0) return false
  if (first.t_ms < 0 || last.t_ms > durationMs) return false
  return first.t_ms + durationMs - last.t_ms <= gapLimitMs
}

function locationPathIsClosed(
  samples: readonly SanitizedLocationSample[],
  durationMs: number,
  gapLimitMs: number,
) {
  if (
    samples.length < 3 ||
    !sampleSeamIsContinuous(samples, durationMs, gapLimitMs)
  ) {
    return false
  }

  const stepDistances: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const distance = Math.hypot(
      samples[index].x - samples[index - 1].x,
      samples[index].y - samples[index - 1].y,
    )
    if (distance > 0) stepDistances.push(distance)
  }
  const typicalStepDistance = median(stepDistances)
  if (typicalStepDistance <= 0) return false

  const first = samples[0]
  const last = samples.at(-1)!
  const seamDistance = Math.hypot(first.x - last.x, first.y - last.y)

  // A real lap seam should look like one or two ordinary location steps. This
  // keeps partial arcs and synthetic open paths from being wrapped by mistake.
  return seamDistance <= typicalStepDistance * 3
}

function extendAcrossLapSeam<T extends { t_ms: number }>(
  samples: readonly T[],
  durationMs: number,
): T[] {
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last || durationMs <= 0) return [...samples]
  return [
    { ...last, t_ms: last.t_ms - durationMs },
    ...samples,
    { ...first, t_ms: first.t_ms + durationMs },
  ]
}

function wrappedIndex(index: number, periodSteps: number) {
  return ((index % periodSteps) + periodSteps) % periodSteps
}

function sampleReliableAt<T extends { t_ms: number }>(
  samples: readonly T[],
  targetMs: number,
  gapLimitMs: number,
) {
  const first = samples[0]
  if (!first) return false
  if (targetMs <= first.t_ms) return first.t_ms - targetMs <= gapLimitMs
  const last = samples.at(-1)!
  if (targetMs >= last.t_ms) return targetMs - last.t_ms <= gapLimitMs
  const upperIndex = upperTimeIndex(samples, targetMs)
  return samples[upperIndex].t_ms - samples[upperIndex - 1].t_ms <= gapLimitMs
}

function windowIsReliable(
  reliable: readonly boolean[],
  index: number,
  radiusSteps: number,
  periodSteps: number | null = null,
) {
  if (periodSteps !== null) {
    const center = wrappedIndex(index, periodSteps)
    for (let offset = -radiusSteps; offset <= radiusSteps; offset += 1) {
      if (!reliable[wrappedIndex(center + offset, periodSteps)]) return false
    }
    return true
  }
  const lower = Math.max(0, index - radiusSteps)
  const upper = Math.min(reliable.length - 1, index + radiusSteps)
  for (let cursor = lower; cursor <= upper; cursor += 1) {
    if (!reliable[cursor]) return false
  }
  return true
}

function locationAt(
  samples: readonly SanitizedLocationSample[],
  targetMs: number,
  gapLimitMs: number,
) {
  const first = samples[0]
  if (!first) return null
  if (samples.length === 1) {
    return {
      point: { x: first.x, y: first.y },
      reliable: Math.abs(targetMs - first.t_ms) <= gapLimitMs,
    }
  }

  if (targetMs <= first.t_ms) {
    return {
      point: { x: first.x, y: first.y },
      reliable: first.t_ms - targetMs <= gapLimitMs,
    }
  }

  const last = samples.at(-1)!
  if (targetMs >= last.t_ms) {
    return {
      point: { x: last.x, y: last.y },
      reliable: targetMs - last.t_ms <= gapLimitMs,
    }
  }

  const upperIndex = upperTimeIndex(samples, targetMs)
  const lower = samples[upperIndex - 1]
  const upper = samples[upperIndex]
  const span = Math.max(1, upper.t_ms - lower.t_ms)
  const alpha = clamp((targetMs - lower.t_ms) / span, 0, 1)
  return {
    point: {
      x: lower.x + (upper.x - lower.x) * alpha,
      y: lower.y + (upper.y - lower.y) * alpha,
    },
    reliable: span <= gapLimitMs,
  }
}

function integrateSpeedMeters(
  samples: readonly SanitizedCarSample[],
  startMs: number,
  endMs: number,
) {
  if (samples.length === 0 || endMs <= startMs) return 0

  const times = [
    startMs,
    ...samples
      .map((sample) => sample.t_ms)
      .filter((time) => time > startMs && time < endMs),
    endMs,
  ]
  let distanceMeters = 0
  let previous = carValuesAt(samples, times[0])

  for (let index = 1; index < times.length; index += 1) {
    const current = carValuesAt(samples, times[index])
    if (previous && current) {
      const elapsedSeconds = (times[index] - times[index - 1]) / 1_000
      const averageMetersPerSecond =
        ((previous.speed + current.speed) * 0.5) / 3.6
      distanceMeters += averageMetersPerSecond * elapsedSeconds
    }
    previous = current
  }

  return distanceMeters
}

function inferLocationScaleMetersPerUnit(
  locations: readonly SanitizedLocationSample[],
  carData: readonly SanitizedCarSample[],
) {
  if (locations.length < 3 || carData.length < 2) return null

  let rawDistance = 0
  for (let index = 1; index < locations.length; index += 1) {
    rawDistance += Math.hypot(
      locations[index].x - locations[index - 1].x,
      locations[index].y - locations[index - 1].y,
    )
  }

  const startMs = locations[0].t_ms
  const endMs = locations.at(-1)!.t_ms
  const speedDistance = integrateSpeedMeters(carData, startMs, endMs)
  const scale = speedDistance / rawDistance
  return Number.isFinite(scale) && scale > 1e-6 && scale < 1e6
    ? scale
    : null
}

function smoothNumbers(
  values: readonly number[],
  radiusSteps: number,
  periodSteps: number | null = null,
): number[] {
  if (radiusSteps <= 0) return [...values]
  return values.map((_, index) => {
    let weightedSum = 0
    let weightSum = 0
    const lowerOffset =
      periodSteps === null ? Math.max(-radiusSteps, -index) : -radiusSteps
    const upperOffset =
      periodSteps === null
        ? Math.min(radiusSteps, values.length - 1 - index)
        : radiusSteps
    for (let offset = lowerOffset; offset <= upperOffset; offset += 1) {
      const cursor =
        periodSteps === null
          ? index + offset
          : wrappedIndex(index + offset, periodSteps)
      const distance = Math.abs(offset) / (radiusSteps + 1)
      const weight = 1 - distance
      weightedSum += values[cursor] * weight
      weightSum += weight
    }
    return weightSum > 0 ? weightedSum / weightSum : values[index]
  })
}

function smoothNullableNumbers(
  values: readonly (number | null)[],
  radiusSteps: number,
  periodSteps: number | null = null,
): (number | null)[] {
  if (radiusSteps <= 0) return [...values]
  return values.map((value, index) => {
    let weightedSum = 0
    let weightSum = 0
    const lowerOffset =
      periodSteps === null ? Math.max(-radiusSteps, -index) : -radiusSteps
    const upperOffset =
      periodSteps === null
        ? Math.min(radiusSteps, values.length - 1 - index)
        : radiusSteps
    for (let offset = lowerOffset; offset <= upperOffset; offset += 1) {
      const cursor =
        periodSteps === null
          ? index + offset
          : wrappedIndex(index + offset, periodSteps)
      const candidate = values[cursor]
      if (candidate === null) continue
      const distance = Math.abs(offset) / (radiusSteps + 1)
      const weight = 1 - distance
      weightedSum += candidate * weight
      weightSum += weight
    }
    return weightSum > 0 ? weightedSum / weightSum : value
  })
}

function localSlope(
  values: readonly (number | null)[],
  timesSeconds: readonly number[],
  index: number,
  radiusSteps: number,
  periodSteps: number | null = null,
  periodSeconds: number | null = null,
) {
  if (periodSteps !== null && periodSeconds !== null && periodSeconds > 0) {
    const center = wrappedIndex(index, periodSteps)
    const secondsPerStep = periodSeconds / periodSteps
    let numerator = 0
    let denominator = 0
    for (let offset = -radiusSteps; offset <= radiusSteps; offset += 1) {
      const value = values[wrappedIndex(center + offset, periodSteps)]
      if (value === null) continue
      const centeredTime = offset * secondsPerStep
      numerator += centeredTime * value
      denominator += centeredTime * centeredTime
    }
    return denominator > 1e-12 ? numerator / denominator : null
  }

  const lower = Math.max(0, index - radiusSteps)
  const upper = Math.min(values.length - 1, index + radiusSteps)
  let count = 0
  let meanTime = 0
  let meanValue = 0

  for (let cursor = lower; cursor <= upper; cursor += 1) {
    const value = values[cursor]
    if (value === null) continue
    count += 1
    meanTime += timesSeconds[cursor]
    meanValue += value
  }
  if (count < 2) return null
  meanTime /= count
  meanValue /= count

  let numerator = 0
  let denominator = 0
  for (let cursor = lower; cursor <= upper; cursor += 1) {
    const value = values[cursor]
    if (value === null) continue
    const centeredTime = timesSeconds[cursor] - meanTime
    numerator += centeredTime * (value - meanValue)
    denominator += centeredTime * centeredTime
  }

  return denominator > 1e-12 ? numerator / denominator : null
}

function curvatureThroughPoints(a: Point, b: Point, c: Point) {
  const ab = Math.hypot(b.x - a.x, b.y - a.y)
  const bc = Math.hypot(c.x - b.x, c.y - b.y)
  const ac = Math.hypot(c.x - a.x, c.y - a.y)
  const denominator = ab * bc * ac
  if (denominator < 1e-6) return null

  const cross =
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const curvature = (2 * cross) / denominator
  return Number.isFinite(curvature) ? curvature : null
}

function turnDirection(lateralG: number | null): PhysicsTurnDirection {
  if (lateralG === null || Math.abs(lateralG) < MIN_DIRECTION_LATERAL_G) {
    return 'straight'
  }
  return lateralG > 0 ? 'left' : 'right'
}

function plausibleG(value: number | null) {
  if (
    value === null ||
    !Number.isFinite(value) ||
    Math.abs(value) >= MAX_ABSOLUTE_G
  ) {
    return null
  }
  return Math.abs(value) < 1e-9 ? 0 : value
}

function combinedG(longitudinalG: number | null, lateralG: number | null) {
  return longitudinalG === null || lateralG === null
    ? null
    : Math.hypot(longitudinalG, lateralG)
}

function montrealTrackLabelAt(timeSeconds: number, durationSeconds: number) {
  if (durationSeconds <= 0) return 'Circuit section'
  const referenceTime =
    (clamp(timeSeconds, 0, durationSeconds) / durationSeconds) *
    MONTREAL_REFERENCE_DURATION_SECONDS
  return (
    MONTREAL_SECTIONS.find(
      (section, index) =>
        referenceTime >= section.start &&
        (referenceTime < section.end ||
          (index === MONTREAL_SECTIONS.length - 1 &&
            referenceTime <= section.end)),
    )?.label ?? 'Circuit section'
  )
}

function activeMoment(
  cornering: boolean,
  brakeActive: boolean,
  throttlePercent: number,
  longitudinalG: number | null,
  lateralEnvelopeSlopeGPerSecond: number | null,
): PhysicsTimelineSample['moment'] {
  if (longitudinalG !== null && longitudinalG < -1.8) {
    return 'braking'
  }

  if (
    !cornering &&
    (brakeActive || (longitudinalG !== null && longitudinalG < -0.35))
  ) {
    return 'braking'
  }

  if (
    throttlePercent >= 95 &&
    (longitudinalG === null || longitudinalG >= -0.15)
  ) {
    return 'full-throttle'
  }

  if (cornering) {
    if (
      brakeActive ||
      (longitudinalG !== null && longitudinalG < -0.12)
    ) {
      return 'corner-entry'
    }
    if (
      longitudinalG !== null &&
      longitudinalG > 0.12 &&
      throttlePercent >= 55
    ) {
      return 'corner-exit'
    }
    if (
      lateralEnvelopeSlopeGPerSecond !== null &&
      lateralEnvelopeSlopeGPerSecond > 0.25
    ) {
      return 'corner-entry'
    }
    if (
      lateralEnvelopeSlopeGPerSecond !== null &&
      lateralEnvelopeSlopeGPerSecond < -0.25 &&
      throttlePercent >= 55
    ) {
      return 'corner-exit'
    }
    return 'apex'
  }
  return 'straight'
}

function curatedMontrealMomentAt(
  timeSeconds: number,
  durationSeconds: number,
): PhysicsTimelineSample['moment'] | null {
  if (Math.abs(durationSeconds - MONTREAL_REFERENCE_DURATION_SECONDS) > 0.05) {
    return null
  }
  const contact = AUDITED_CURB_CONTACTS.find(
    (candidate) =>
      timeSeconds >= candidate.startLapTimeSeconds &&
      timeSeconds <= candidate.endLapTimeSeconds,
  )
  if (!contact) return null
  if (contact.label.toLowerCase().includes('apex')) return 'apex'
  if (contact.label.toLowerCase().includes('exit')) return 'corner-exit'
  return null
}

function sustainedCornerStates(
  lateralGValues: readonly (number | null)[],
  sampleRateHz: number,
) {
  const states: boolean[] = []
  let active = false
  for (const value of lateralGValues) {
    const magnitude = value === null ? 0 : Math.abs(value)
    if (!active && magnitude >= CORNER_ENTER_LATERAL_G) active = true
    else if (active && (value === null || magnitude <= CORNER_EXIT_LATERAL_G)) {
      active = false
    }
    states.push(active)
  }

  const minimumRunSteps = Math.max(
    1,
    Math.round(CORNER_MINIMUM_DWELL_SECONDS * sampleRateHz),
  )
  let runStart = 0
  while (runStart < states.length) {
    const state = states[runStart]
    let runEnd = runStart + 1
    while (runEnd < states.length && states[runEnd] === state) runEnd += 1
    if (state && runEnd - runStart < minimumRunSteps) {
      states.fill(false, runStart, runEnd)
    }
    runStart = runEnd
  }
  return states
}

function numericRange(values: readonly (number | null)[]) {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    ? { minimum, maximum }
    : null
}

function signedRange(values: readonly (number | null)[]) {
  const range = numericRange(values)
  return range
    ? {
        ...range,
        peakAbsolute: Math.max(Math.abs(range.minimum), Math.abs(range.maximum)),
      }
    : null
}

function channelMetadata(
  hasLongitudinal: boolean,
  hasPath: boolean,
): PhysicsChannelMetadataMap {
  const derivedConfidence: PhysicsConfidence = hasLongitudinal
    ? 'medium'
    : 'unavailable'
  const pathConfidence: PhysicsConfidence = hasPath ? 'medium' : 'unavailable'
  return {
    speedKph: {
      provenance: 'recorded',
      confidence: 'high',
      method: 'Linear interpolation of cached OpenF1 speed samples',
    },
    longitudinalG: {
      provenance: 'derived',
      confidence: derivedConfidence,
      method: 'Centered, time-aware derivative of smoothed recorded speed',
    },
    lateralG: {
      provenance: 'estimated',
      confidence: pathConfidence,
      method: 'Speed squared multiplied by smoothed reconstructed path curvature',
    },
    combinedG: {
      provenance: 'estimated',
      confidence:
        hasLongitudinal && hasPath ? 'medium' : ('unavailable' as const),
      method: 'Horizontal vector magnitude of longitudinal and lateral G',
    },
    turnRadiusMeters: {
      provenance: 'estimated',
      confidence: pathConfidence,
      method: 'Inverse magnitude of smoothed reconstructed path curvature',
    },
  }
}

/**
 * Precompute the replay's display-oriented physics once (for example in
 * `useMemo`). Centered filters are possible because the complete lap is cached;
 * they reduce OpenF1 packet noise without adding playback latency.
 *
 * Lateral G and radius describe the car body's horizontal motion estimate. They
 * are not individual tyre loads, downforce, steering angle, or suspension data.
 */
export function createPhysicsWorkbook(
  input: PhysicsWorkbookInput,
  options: PhysicsWorkbookOptions = {},
): PhysicsWorkbook {
  const carData = sanitizeCarData(input.car_data)
  const locations = sanitizeLocations(input.location)
  const lastTimestampMs = Math.max(
    carData.at(-1)?.t_ms ?? 0,
    locations.at(-1)?.t_ms ?? 0,
  )
  const durationSeconds = Math.max(
    0,
    finiteOr(
      options.durationSeconds,
      finiteOr(input.lap?.lap_duration, lastTimestampMs / 1_000),
    ),
  )
  const sampleRateHz = clamp(
    finiteOr(options.sampleRateHz, DEFAULT_SAMPLE_RATE_HZ),
    5,
    60,
  )
  const hasLongitudinal = carData.length >= 2 && durationSeconds > 0
  const locationScaleMetersPerUnit = inferLocationScaleMetersPerUnit(
    locations,
    carData,
  )
  const hasPath =
    locations.length >= 3 && locationScaleMetersPerUnit !== null && durationSeconds > 0
  const channels = channelMetadata(hasLongitudinal, hasPath)

  if (carData.length === 0 || durationSeconds <= 0) {
    return {
      durationSeconds,
      sampleRateHz,
      timeline: [],
      channels,
      lapReference: {
        speedKph: null,
        longitudinalG: null,
        lateralG: null,
        combinedG: null,
      },
      locationScaleMetersPerUnit,
    }
  }

  const sampleCount = Math.max(2, Math.ceil(durationSeconds * sampleRateHz) + 1)
  const timesSeconds = Array.from(
    { length: sampleCount },
    (_, index) => Math.min(durationSeconds, index / sampleRateHz),
  )
  const carGapLimitMs = sampleGapLimitMs(carData)
  const locationGapLimitMs = sampleGapLimitMs(locations)
  const durationMs = durationSeconds * 1_000
  const closedLoop =
    hasPath &&
    locationPathIsClosed(locations, durationMs, locationGapLimitMs) &&
    sampleSeamIsContinuous(carData, durationMs, carGapLimitMs)
  const periodSteps = closedLoop ? sampleCount - 1 : null
  const interpolationCarData = closedLoop
    ? extendAcrossLapSeam(carData, durationMs)
    : carData
  const carValues = timesSeconds.map(
    (timeSeconds) => carValuesAt(carData, timeSeconds * 1_000)!,
  )
  const reconstructedCarValues = timesSeconds.map(
    (timeSeconds) =>
      carValuesAt(interpolationCarData, timeSeconds * 1_000)!,
  )
  const carReliable = timesSeconds.map((timeSeconds) =>
    sampleReliableAt(
      interpolationCarData,
      timeSeconds * 1_000,
      carGapLimitMs,
    ),
  )
  const speedKph = carValues.map((sample) => sample.speed)
  const reconstructedSpeedKph = reconstructedCarValues.map(
    (sample) => sample.speed,
  )
  const speedSmoothingSteps = Math.round(
    SPEED_SMOOTHING_SECONDS * sampleRateHz,
  )
  const smoothedSpeedMetersPerSecond = smoothNumbers(
    reconstructedSpeedKph.map((speed) => speed / 3.6),
    speedSmoothingSteps,
    periodSteps,
  )
  const accelerationWindowSteps = Math.max(
    1,
    Math.round(ACCELERATION_WINDOW_SECONDS * sampleRateHz),
  )
  const longitudinalSupportSteps =
    speedSmoothingSteps + accelerationWindowSteps
  const longitudinalGValues = smoothedSpeedMetersPerSecond.map((_, index) => {
    if (
      !hasLongitudinal ||
      (periodSteps === null && index < longitudinalSupportSteps) ||
      (periodSteps === null &&
        index > sampleCount - 1 - longitudinalSupportSteps) ||
      !windowIsReliable(
        carReliable,
        index,
        longitudinalSupportSteps,
        periodSteps,
      )
    ) {
      return null
    }
    const slope = localSlope(
      smoothedSpeedMetersPerSecond,
      timesSeconds,
      index,
      accelerationWindowSteps,
      periodSteps,
      closedLoop ? durationSeconds : null,
    )
    if (slope === null) return null
    return plausibleG(
      slope / STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED,
    )
  })

  let curvatureValues: (number | null)[] = Array(sampleCount).fill(null)
  if (hasPath && locationScaleMetersPerUnit !== null) {
    const interpolationLocations = closedLoop
      ? extendAcrossLapSeam(locations, durationMs)
      : locations
    const sampledLocations = timesSeconds.map((timeSeconds) =>
      locationAt(
        interpolationLocations,
        timeSeconds * 1_000,
        locationGapLimitMs,
      ),
    )
    const scale = locationScaleMetersPerUnit
    const positionSmoothingSteps = Math.round(
      POSITION_SMOOTHING_SECONDS * sampleRateHz,
    )
    const smoothedX = smoothNumbers(
      sampledLocations.map((sample) => (sample?.point.x ?? 0) * scale),
      positionSmoothingSteps,
      periodSteps,
    )
    const smoothedY = smoothNumbers(
      sampledLocations.map((sample) => (sample?.point.y ?? 0) * scale),
      positionSmoothingSteps,
      periodSteps,
    )
    const reliable = sampledLocations.map((sample) => sample?.reliable ?? false)
    const spanSteps = Math.max(
      1,
      Math.round(CURVATURE_SPAN_SECONDS * sampleRateHz),
    )
    const curvatureEdgeSupportSteps = positionSmoothingSteps + spanSteps

    curvatureValues = timesSeconds.map((_, index) => {
      const firstIndex =
        periodSteps === null
          ? index - spanSteps
          : wrappedIndex(index - spanSteps, periodSteps)
      const middleIndex =
        periodSteps === null ? index : wrappedIndex(index, periodSteps)
      const lastIndex =
        periodSteps === null
          ? index + spanSteps
          : wrappedIndex(index + spanSteps, periodSteps)
      if (
        (periodSteps === null && index < curvatureEdgeSupportSteps) ||
        (periodSteps === null &&
          index > sampleCount - 1 - curvatureEdgeSupportSteps) ||
        !windowIsReliable(
          reliable,
          middleIndex,
          spanSteps + positionSmoothingSteps,
          periodSteps,
        )
      ) {
        return null
      }
      return curvatureThroughPoints(
        { x: smoothedX[firstIndex], y: smoothedY[firstIndex] },
        { x: smoothedX[middleIndex], y: smoothedY[middleIndex] },
        { x: smoothedX[lastIndex], y: smoothedY[lastIndex] },
      )
    })
    const rawCurvatureValues = curvatureValues
    const rawCurvatureReliable = rawCurvatureValues.map(
      (value) => value !== null,
    )
    const curvatureSmoothingSteps = Math.round(
      CURVATURE_SMOOTHING_SECONDS * sampleRateHz,
    )
    curvatureValues = smoothNullableNumbers(
      rawCurvatureValues,
      curvatureSmoothingSteps,
      periodSteps,
    ).map((curvature, index) => {
      if (
        curvature === null ||
        !windowIsReliable(
          rawCurvatureReliable,
          index,
          curvatureSmoothingSteps,
          periodSteps,
        )
      ) {
        return null
      }
      const renderedCurvature = curvature * MONTREAL_RENDERED_TURN_SIGN
      return Math.abs(renderedCurvature) <= 1 / 12
        ? renderedCurvature
        : null
    })
  }

  const lateralGValues = curvatureValues.map((curvature, index) => {
    if (curvature === null) return null
    const speedMetersPerSecond = smoothedSpeedMetersPerSecond[index]
    return plausibleG(
      (speedMetersPerSecond * speedMetersPerSecond * curvature) /
        STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED,
    )
  })
  const lateralEnvelope = lateralGValues.map((value) =>
    value === null ? null : Math.abs(value),
  )
  const lateralEnvelopeSlopes = lateralEnvelope.map((_, index) =>
    localSlope(
      lateralEnvelope,
      timesSeconds,
      index,
      Math.max(1, Math.round(0.5 * sampleRateHz)),
      periodSteps,
      closedLoop ? durationSeconds : null,
    ),
  )
  const cornerStates = sustainedCornerStates(lateralGValues, sampleRateHz)

  const timeline = timesSeconds.map<PhysicsTimelineSample>(
    (timeSeconds, index) => {
      const longitudinalG = longitudinalGValues[index]
      const lateralG = lateralGValues[index]
      const curvature = curvatureValues[index]
      const turnRadiusMeters =
        cornerStates[index] &&
        curvature !== null &&
        Math.abs(curvature) >= MIN_RADIUS_CURVATURE_PER_METER
          ? 1 / Math.abs(curvature)
          : null
      const inferredMoment = activeMoment(
        cornerStates[index],
        carValues[index].brake >= 50,
        carValues[index].throttle,
        longitudinalG,
        lateralEnvelopeSlopes[index],
      )
      const curatedMoment = cornerStates[index]
        ? curatedMontrealMomentAt(timeSeconds, durationSeconds)
        : null
      return {
        timeSeconds,
        speedKph: speedKph[index],
        longitudinalG,
        lateralG,
        combinedG: combinedG(longitudinalG, lateralG),
        turnRadiusMeters,
        turnDirection: cornerStates[index]
          ? turnDirection(lateralG)
          : 'straight',
        trackLabel: montrealTrackLabelAt(timeSeconds, durationSeconds),
        moment: curatedMoment ?? inferredMoment,
      }
    },
  )

  return {
    durationSeconds,
    sampleRateHz,
    timeline,
    channels,
    lapReference: {
      speedKph: numericRange(timeline.map((sample) => sample.speedKph)),
      longitudinalG: signedRange(
        timeline.map((sample) => sample.longitudinalG),
      ),
      lateralG: signedRange(timeline.map((sample) => sample.lateralG)),
      combinedG: numericRange(timeline.map((sample) => sample.combinedG)),
    },
    locationScaleMetersPerUnit,
  }
}

function boundaryReading(
  status: PhysicsBoundaryReading['status'],
  timeSeconds: number,
): PhysicsBoundaryReading {
  if (status === 'pre-lap') {
    return {
      status,
      timeSeconds,
      speedKph: null,
      longitudinalG: null,
      lateralG: null,
      combinedG: null,
      turnRadiusMeters: null,
      turnDirection: 'straight',
      trackLabel: 'Pre-lap',
      moment: 'pre-lap',
    }
  }
  if (status === 'complete') {
    return {
      status,
      timeSeconds,
      speedKph: null,
      longitudinalG: null,
      lateralG: null,
      combinedG: null,
      turnRadiusMeters: null,
      turnDirection: 'straight',
      trackLabel: 'Lap complete',
      moment: 'lap-complete',
    }
  }
  return {
    status,
    timeSeconds,
    speedKph: null,
    longitudinalG: null,
    lateralG: null,
    combinedG: null,
    turnRadiusMeters: null,
    turnDirection: 'straight',
    trackLabel: 'Physics unavailable',
    moment: 'unavailable',
  }
}

function interpolateNullable(
  lower: number | null,
  upper: number | null,
  alpha: number,
) {
  if (lower === null && upper === null) return null
  if (lower === null) return alpha < 0.5 ? null : upper
  if (upper === null) return alpha < 0.5 ? lower : null
  return lower + (upper - lower) * alpha
}

/** Resolve a precomputed workbook at the shared, lap-relative playhead. */
export function physicsAt(
  workbook: PhysicsWorkbook,
  playheadSeconds: number,
): PhysicsReading {
  if (!Number.isFinite(playheadSeconds)) {
    return boundaryReading('unavailable', 0)
  }
  if (playheadSeconds < 0) {
    return boundaryReading('pre-lap', playheadSeconds)
  }
  if (workbook.timeline.length === 0) {
    return boundaryReading('unavailable', playheadSeconds)
  }
  if (playheadSeconds >= workbook.durationSeconds) {
    return boundaryReading('complete', playheadSeconds)
  }

  const timeline = workbook.timeline
  let low = 0
  let high = timeline.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (timeline[middle].timeSeconds < playheadSeconds) low = middle + 1
    else high = middle
  }

  if (low === 0) return { ...timeline[0], status: 'active' }
  const upper = timeline[Math.min(low, timeline.length - 1)]
  const lower = timeline[low - 1]
  const span = Math.max(1e-9, upper.timeSeconds - lower.timeSeconds)
  const alpha = clamp((playheadSeconds - lower.timeSeconds) / span, 0, 1)
  const nearest = alpha < 0.5 ? lower : upper
  const longitudinalG = interpolateNullable(
    lower.longitudinalG,
    upper.longitudinalG,
    alpha,
  )
  const lateralG = interpolateNullable(lower.lateralG, upper.lateralG, alpha)
  const sameTurnDirection = lower.turnDirection === upper.turnDirection
  const turnRadiusMeters =
    nearest.turnDirection !== 'straight' && sameTurnDirection
      ? interpolateNullable(
          lower.turnRadiusMeters,
          upper.turnRadiusMeters,
          alpha,
        )
      : nearest.turnRadiusMeters

  return {
    status: 'active',
    timeSeconds: playheadSeconds,
    speedKph: lower.speedKph + (upper.speedKph - lower.speedKph) * alpha,
    longitudinalG,
    lateralG,
    combinedG: combinedG(longitudinalG, lateralG),
    turnRadiusMeters,
    turnDirection: nearest.turnDirection,
    trackLabel: montrealTrackLabelAt(
      playheadSeconds,
      workbook.durationSeconds,
    ),
    moment: nearest.moment,
  }
}
