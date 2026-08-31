import type { ReplayCarSample } from './replay'

export type TelemetrySample = Pick<
  ReplayCarSample,
  'speed' | 'rpm' | 'n_gear' | 'throttle' | 'brake' | 'drs'
>

type NumericRange = {
  minimum: number
  maximum: number
}

export type TelemetryRanges = {
  speed: NumericRange
  rpm: NumericRange
  gear: NumericRange
  throttle: NumericRange
  sampleRateHz: number | null
}

export type DrsPresentation = {
  label: 'Open' | 'Ready' | 'Closed' | 'Standby'
  state: 'open' | 'ready' | 'closed' | 'standby'
}

const ACTIVE_DRS_VALUES = new Set([10, 12, 14])
const SECTOR_BOUNDARY_EPSILON_SECONDS = 1e-9

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function interpolate(lower: number, upper: number, alpha: number) {
  return lower + (upper - lower) * alpha
}

function telemetryFields(sample: ReplayCarSample): TelemetrySample {
  return {
    speed: sample.speed,
    rpm: sample.rpm,
    n_gear: sample.n_gear,
    throttle: sample.throttle,
    brake: sample.brake,
    drs: sample.drs,
  }
}

export function telemetryAt(
  carData: readonly ReplayCarSample[],
  playheadSeconds: number,
): TelemetrySample | null {
  if (carData.length === 0 || playheadSeconds < 0) return null

  const targetMs = playheadSeconds * 1000
  let low = 0
  let high = carData.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (carData[middle].t_ms < targetMs) low = middle + 1
    else high = middle
  }

  if (low === 0) return telemetryFields(carData[0])
  if (low >= carData.length) return telemetryFields(carData.at(-1)!)

  const lower = carData[low - 1]
  const upper = carData[low]
  const sampleSpan = Math.max(1, upper.t_ms - lower.t_ms)
  const alpha = clamp((targetMs - lower.t_ms) / sampleSpan, 0, 1)
  const discreteSample = alpha < 0.5 ? lower : upper

  return {
    speed: interpolate(lower.speed, upper.speed, alpha),
    rpm: interpolate(lower.rpm, upper.rpm, alpha),
    throttle: interpolate(lower.throttle, upper.throttle, alpha),
    brake: discreteSample.brake,
    n_gear: discreteSample.n_gear,
    drs: discreteSample.drs,
  }
}

export function telemetryRanges(
  carData: readonly ReplayCarSample[],
): TelemetryRanges | null {
  const first = carData[0]
  if (!first) return null

  const ranges: TelemetryRanges = {
    speed: { minimum: first.speed, maximum: first.speed },
    rpm: { minimum: first.rpm, maximum: first.rpm },
    gear: { minimum: first.n_gear, maximum: first.n_gear },
    throttle: { minimum: first.throttle, maximum: first.throttle },
    sampleRateHz: null,
  }

  for (let index = 1; index < carData.length; index += 1) {
    const sample = carData[index]
    ranges.speed.minimum = Math.min(ranges.speed.minimum, sample.speed)
    ranges.speed.maximum = Math.max(ranges.speed.maximum, sample.speed)
    ranges.rpm.minimum = Math.min(ranges.rpm.minimum, sample.rpm)
    ranges.rpm.maximum = Math.max(ranges.rpm.maximum, sample.rpm)
    ranges.gear.minimum = Math.min(ranges.gear.minimum, sample.n_gear)
    ranges.gear.maximum = Math.max(ranges.gear.maximum, sample.n_gear)
    ranges.throttle.minimum = Math.min(
      ranges.throttle.minimum,
      sample.throttle,
    )
    ranges.throttle.maximum = Math.max(
      ranges.throttle.maximum,
      sample.throttle,
    )
  }

  const last = carData.at(-1)!
  const sampledDurationSeconds = (last.t_ms - first.t_ms) / 1000
  if (carData.length > 1 && sampledDurationSeconds > 0) {
    ranges.sampleRateHz = (carData.length - 1) / sampledDurationSeconds
  }

  return ranges
}

export function drsPresentation(drs: number | null): DrsPresentation {
  if (drs === null) return { label: 'Standby', state: 'standby' }
  if (ACTIVE_DRS_VALUES.has(drs)) return { label: 'Open', state: 'open' }
  if (drs === 8) return { label: 'Ready', state: 'ready' }
  return { label: 'Closed', state: 'closed' }
}

export function formatLapTime(seconds: number) {
  const absolute = Math.abs(seconds)
  const minutes = Math.floor(absolute / 60)
  const wholeSeconds = Math.floor(absolute % 60)
  const milliseconds = Math.floor((absolute % 1) * 1000)
  const sign = seconds < 0 ? '-' : ''
  return `${sign}${minutes}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

export function timingSectorAt(
  playheadSeconds: number,
  sectorDurationsSeconds: readonly number[],
  lapDurationSeconds: number,
) {
  if (playheadSeconds < 0) return 'Pre-lap'
  if (playheadSeconds >= lapDurationSeconds) return 'Complete'

  let sectorEnd = 0
  for (let index = 0; index < sectorDurationsSeconds.length; index += 1) {
    sectorEnd += sectorDurationsSeconds[index]
    if (playheadSeconds < sectorEnd - SECTOR_BOUNDARY_EPSILON_SECONDS) {
      return `S${index + 1}`
    }
  }
  return `S${sectorDurationsSeconds.length}`
}
