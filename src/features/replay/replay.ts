import { RUNTIME_ASSETS } from '../../runtimeAssets.ts'

export type ReplayCarSample = {
  date: string
  t_ms: number
  speed: number
  rpm: number
  n_gear: number
  throttle: number
  brake: number
  drs: number
}

export type ReplayLocationSample = {
  date: string
  t_ms: number
  x: number
  y: number
  z: number
}

export type ReplayFile = {
  schema_version: 1
  source: 'openf1' | 'mock'
  pulled_at: string
  session_key: number
  meeting_key: number | null
  circuit_short_name: string
  session_name: string
  year: number
  driver: {
    driver_number: number
    name_acronym: string
    full_name: string
    team_name: string
  }
  lap: {
    lap_number: number
    lap_duration: number | null
    date_start: string | null
  }
  car_data: ReplayCarSample[]
  location: ReplayLocationSample[]
  notes?: string[]
}

type SampleStreamMetadata = {
  count: number
  firstTimeMs: number
  lastTimeMs: number
  maximumGapMs: number
}

export type ReplayRuntimeMetadata = {
  provider: 'OpenF1'
  identity: typeof REPLAY_VALIDATION_CONTRACT.identity
  samples: {
    carData: SampleStreamMetadata
    location: SampleStreamMetadata
  }
  integrity: ReplayIntegrityMetadata
}

export type ReplayIntegrityMetadata = {
  algorithm: 'SHA-256'
  expectedSha256: string | null
  actualSha256: string | null
  verified: boolean
}

export type ReplayValidationResult = {
  replay: ReplayFile
  metadata: ReplayRuntimeMetadata
}

/**
 * The immutable v1 replay contract. Keeping identity and stream requirements
 * next to the decoder prevents a valid-looking cache for another session,
 * driver, or lap from entering the synchronized clock.
 */
export const REPLAY_VALIDATION_CONTRACT = {
  schemaVersion: 1,
  identity: {
    source: 'openf1',
    sessionKey: 9527,
    year: 2024,
    circuitShortName: 'Montreal',
    sessionName: 'Qualifying',
    driverNumber: 63,
    lapNumber: 22,
    lapDurationSeconds: 72,
  },
  samples: {
    carData: {
      minimumCount: 250,
      maximumGapMs: 1_000,
      startToleranceMs: 1_000,
      endToleranceMs: 1_000,
    },
    location: {
      minimumCount: 250,
      maximumGapMs: 1_000,
      startToleranceMs: 1_000,
      endToleranceMs: 1_000,
    },
  },
  checksum: {
    algorithm: 'SHA-256',
    environmentVariable: 'VITE_REPLAY_SHA256',
  },
} as const

export const REPLAY_URL = RUNTIME_ASSETS.replay.url

export class ReplayValidationError extends Error {
  override name = 'ReplayValidationError'
}

function fail(message: string): never {
  throw new ReplayValidationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${field} must be an object.`)
  return value
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} must be a finite number.`)
  }
  return value
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${field} must be a non-empty string.`)
  }
  return value
}

function validDate(value: unknown, field: string): string {
  const date = nonEmptyString(value, field)
  if (!Number.isFinite(Date.parse(date))) fail(`${field} must be an ISO date.`)
  return date
}

function exact<T>(actual: T, expected: T, field: string): void {
  if (actual !== expected) {
    fail(`${field} must be ${String(expected)}; received ${String(actual)}.`)
  }
}

function inRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = finiteNumber(value, field)
  if (number < minimum || number > maximum) {
    fail(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return number
}

function sampleStreamMetadata(
  value: unknown,
  field: 'car_data' | 'location',
  durationMs: number,
): SampleStreamMetadata {
  if (!Array.isArray(value)) fail(`${field} must be an array.`)

  const requirements =
    field === 'car_data'
      ? REPLAY_VALIDATION_CONTRACT.samples.carData
      : REPLAY_VALIDATION_CONTRACT.samples.location
  if (value.length < requirements.minimumCount) {
    fail(
      `${field} requires at least ${requirements.minimumCount} samples; received ${value.length}.`,
    )
  }

  let firstTimeMs = Number.NaN
  let lastTimeMs = Number.NaN
  let maximumGapMs = 0

  value.forEach((sampleValue, index) => {
    const sample = record(sampleValue, `${field}[${index}]`)
    validDate(sample.date, `${field}[${index}].date`)
    const timeMs = inRange(
      sample.t_ms,
      0,
      durationMs,
      `${field}[${index}].t_ms`,
    )

    if (index === 0) {
      firstTimeMs = timeMs
    } else {
      const gapMs = timeMs - lastTimeMs
      if (gapMs <= 0) {
        fail(`${field} timestamps must be strictly increasing.`)
      }
      maximumGapMs = Math.max(maximumGapMs, gapMs)
    }
    lastTimeMs = timeMs

    if (field === 'car_data') {
      inRange(sample.speed, 0, 400, `${field}[${index}].speed`)
      inRange(sample.rpm, 0, 20_000, `${field}[${index}].rpm`)
      inRange(sample.n_gear, -1, 8, `${field}[${index}].n_gear`)
      inRange(sample.throttle, 0, 100, `${field}[${index}].throttle`)
      inRange(sample.brake, 0, 100, `${field}[${index}].brake`)
      inRange(sample.drs, 0, 14, `${field}[${index}].drs`)
    } else {
      finiteNumber(sample.x, `${field}[${index}].x`)
      finiteNumber(sample.y, `${field}[${index}].y`)
      finiteNumber(sample.z, `${field}[${index}].z`)
    }
  })

  if (firstTimeMs > requirements.startToleranceMs) {
    fail(`${field} begins too late at ${firstTimeMs} ms.`)
  }
  if (lastTimeMs < durationMs - requirements.endToleranceMs) {
    fail(`${field} ends too early at ${lastTimeMs} ms.`)
  }
  if (maximumGapMs > requirements.maximumGapMs) {
    fail(`${field} contains a ${maximumGapMs} ms source-data gap.`)
  }

  return { count: value.length, firstTimeMs, lastTimeMs, maximumGapMs }
}

function unverifiedIntegrity(
  expectedSha256: string | null = null,
): ReplayIntegrityMetadata {
  return {
    algorithm: REPLAY_VALIDATION_CONTRACT.checksum.algorithm,
    expectedSha256,
    actualSha256: null,
    verified: false,
  }
}

export function validateReplayPayload(
  value: unknown,
  integrity: ReplayIntegrityMetadata = unverifiedIntegrity(),
): ReplayValidationResult {
  const replay = record(value, 'replay')
  const driver = record(replay.driver, 'driver')
  const lap = record(replay.lap, 'lap')
  const identity = REPLAY_VALIDATION_CONTRACT.identity

  exact(finiteNumber(replay.schema_version, 'schema_version'), 1, 'schema_version')
  exact(nonEmptyString(replay.source, 'source'), identity.source, 'source')
  validDate(replay.pulled_at, 'pulled_at')
  exact(finiteNumber(replay.session_key, 'session_key'), identity.sessionKey, 'session_key')
  if (replay.meeting_key !== null) finiteNumber(replay.meeting_key, 'meeting_key')
  exact(finiteNumber(replay.year, 'year'), identity.year, 'year')
  exact(
    nonEmptyString(replay.circuit_short_name, 'circuit_short_name'),
    identity.circuitShortName,
    'circuit_short_name',
  )
  exact(
    nonEmptyString(replay.session_name, 'session_name'),
    identity.sessionName,
    'session_name',
  )
  exact(
    finiteNumber(driver.driver_number, 'driver.driver_number'),
    identity.driverNumber,
    'driver.driver_number',
  )
  nonEmptyString(driver.name_acronym, 'driver.name_acronym')
  nonEmptyString(driver.full_name, 'driver.full_name')
  nonEmptyString(driver.team_name, 'driver.team_name')
  exact(
    finiteNumber(lap.lap_number, 'lap.lap_number'),
    identity.lapNumber,
    'lap.lap_number',
  )
  exact(
    finiteNumber(lap.lap_duration, 'lap.lap_duration'),
    identity.lapDurationSeconds,
    'lap.lap_duration',
  )
  validDate(lap.date_start, 'lap.date_start')

  if (
    replay.notes !== undefined &&
    (!Array.isArray(replay.notes) ||
      !replay.notes.every((note) => typeof note === 'string'))
  ) {
    fail('notes must be an array of strings when present.')
  }

  const durationMs = identity.lapDurationSeconds * 1_000
  const samples = {
    carData: sampleStreamMetadata(replay.car_data, 'car_data', durationMs),
    location: sampleStreamMetadata(replay.location, 'location', durationMs),
  }

  return {
    replay: replay as ReplayFile,
    metadata: {
      provider: 'OpenF1',
      identity,
      samples,
      integrity,
    },
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyReplaySha256(
  bytes: ArrayBuffer,
  expectedSha256: string | null,
): Promise<ReplayIntegrityMetadata> {
  if (!expectedSha256) return unverifiedIntegrity()
  if (!globalThis.crypto?.subtle) {
    fail('SHA-256 verification is configured but Web Crypto is unavailable.')
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const actualSha256 = bytesToHex(new Uint8Array(digest))
  if (actualSha256 !== expectedSha256) {
    fail(
      `Replay checksum mismatch; expected ${expectedSha256}, received ${actualSha256}.`,
    )
  }

  return {
    algorithm: REPLAY_VALIDATION_CONTRACT.checksum.algorithm,
    expectedSha256,
    actualSha256,
    verified: true,
  }
}

export async function decodeReplayResponse(
  bytes: ArrayBuffer,
  expectedSha256: string | null = null,
): Promise<ReplayValidationResult> {
  const integrity = await verifyReplaySha256(bytes, expectedSha256)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    fail('Replay cache must contain valid JSON.')
  }
  return validateReplayPayload(value, integrity)
}

export async function loadReplay(): Promise<ReplayFile> {
  const response = await fetch(REPLAY_URL, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Replay cache returned HTTP ${response.status}`)
  }
  const { replay } = await decodeReplayResponse(
    await response.arrayBuffer(),
    RUNTIME_ASSETS.replay.sha256,
  )
  return replay
}
