export type AuthoredLinePoint = {
  /** Wrapped distance around the closed replay route. */
  routeProgress: number
  /** Signed metres from the uncorrected replay route; positive is car-right. */
  offsetMeters: number
}

export type AuthoredRacingLine = {
  schemaVersion: 1
  replayKey: typeof AUTHORED_LINE_REPLAY_KEY
  routeVersion: typeof AUTHORED_LINE_ROUTE_VERSION
  points: AuthoredLinePoint[]
}

export type AuthoredLineSample = {
  offsetMeters: number
  /** Allows a recorded segment to ease into the automatic fallback line. */
  weight: number
}

export type CalibrationDriveInput = {
  active: boolean
  /** Signed route-coordinate motion: -1, 0, or 1. UI controls map into it. */
  direction: -1 | 0 | 1
  /** Changes whenever a fresh take starts. */
  sessionId: number
  /** Entry offset captured while the section is paused. */
  initialOffsetMeters?: number | null
  /** A non-persistent paused preview of the selected section's entry. */
  previewOffsetMeters?: number | null
  /** Lets the renderer stop a bounded record or review exactly at its end. */
  sectionEndLapTimeSeconds?: number | null
  mode?: 'record' | 'review' | null
}

export type CalibrationDriveSample = AuthoredLinePoint & {
  lapTimeSeconds: number
  minimumOffsetMeters: number
  maximumOffsetMeters: number
  roadFraction: number
  boundaryLimited: boolean
}

export const AUTHORED_LINE_REPLAY_KEY = '9527:63:22'
export const AUTHORED_LINE_ROUTE_VERSION = 'montreal-2019-openf1-route-v1'
export const AUTHORED_LINE_STORAGE_KEY =
  'theonboard:montreal:authored-racing-line:v1'

export const AUTHORED_LINE_MAXIMUM_GAP_METERS = 18
export const AUTHORED_LINE_EDGE_BLEND_METERS = 12

const MAXIMUM_ABSOLUTE_OFFSET_METERS = 24
const DUPLICATE_PROGRESS_TOLERANCE = 1e-6

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function wrap01(value: number) {
  if (value >= 0 && value < 1) return value
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function smoothstep01(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Forward distance around a closed route, expressed as a 0–1 lap fraction. */
export function forwardProgressDistance(from: number, to: number) {
  return wrap01(wrap01(to) - wrap01(from))
}

export function cyclicProgressDistance(first: number, second: number) {
  const forward = forwardProgressDistance(first, second)
  return Math.min(forward, 1 - forward)
}

function sanitizePoint(value: unknown): AuthoredLinePoint | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AuthoredLinePoint>
  if (
    typeof candidate.routeProgress !== 'number' ||
    !Number.isFinite(candidate.routeProgress) ||
    typeof candidate.offsetMeters !== 'number' ||
    !Number.isFinite(candidate.offsetMeters)
  ) {
    return null
  }
  return {
    routeProgress: wrap01(candidate.routeProgress),
    offsetMeters: clamp(
      candidate.offsetMeters,
      -MAXIMUM_ABSOLUTE_OFFSET_METERS,
      MAXIMUM_ABSOLUTE_OFFSET_METERS,
    ),
  }
}

export function normalizeAuthoredLinePoints(
  points: readonly AuthoredLinePoint[],
) {
  const sorted = points
    .map(sanitizePoint)
    .filter((point): point is AuthoredLinePoint => point !== null)
    .sort((first, second) => first.routeProgress - second.routeProgress)
  const normalized: AuthoredLinePoint[] = []
  for (const point of sorted) {
    const previous = normalized[normalized.length - 1]
    if (
      previous &&
      Math.abs(point.routeProgress - previous.routeProgress) <=
        DUPLICATE_PROGRESS_TOLERANCE
    ) {
      normalized[normalized.length - 1] = point
    } else {
      normalized.push(point)
    }
  }
  return normalized
}

/**
 * Sample the manually driven line. Dense recorded spans are authoritative;
 * unrecorded gaps ease back to the existing automatic line at their edges.
 */
function sampleNormalizedAuthoredLineAtProgress(
  sorted: readonly AuthoredLinePoint[],
  routeProgress: number,
  curveLengthMeters: number,
  maximumGapMeters = AUTHORED_LINE_MAXIMUM_GAP_METERS,
  edgeBlendMeters = AUTHORED_LINE_EDGE_BLEND_METERS,
): AuthoredLineSample | null {
  const routeLength = Math.max(1e-6, curveLengthMeters)
  const progress = wrap01(routeProgress)
  if (sorted.length === 0) return null

  if (sorted.length === 1) {
    const distanceMeters =
      cyclicProgressDistance(progress, sorted[0].routeProgress) * routeLength
    if (distanceMeters >= edgeBlendMeters) return null
    return {
      offsetMeters: sorted[0].offsetMeters,
      weight: smoothstep01(1 - distanceMeters / edgeBlendMeters),
    }
  }

  let upperIndex = sorted.findIndex(
    (point) => point.routeProgress > progress,
  )
  if (upperIndex < 0) upperIndex = 0
  const lowerIndex = (upperIndex - 1 + sorted.length) % sorted.length
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]
  const wraps = upperIndex === 0
  const lowerProgress = lower.routeProgress
  const upperProgress = wraps ? upper.routeProgress + 1 : upper.routeProgress
  const adjustedProgress =
    wraps && progress < upper.routeProgress ? progress + 1 : progress
  const gapProgress = Math.max(0, upperProgress - lowerProgress)
  const gapMeters = gapProgress * routeLength

  if (gapMeters <= maximumGapMeters) {
    const alpha = gapProgress > 1e-12
      ? clamp((adjustedProgress - lowerProgress) / gapProgress, 0, 1)
      : 0
    return {
      offsetMeters:
        lower.offsetMeters + (upper.offsetMeters - lower.offsetMeters) * alpha,
      weight: 1,
    }
  }

  const fromLowerMeters =
    forwardProgressDistance(lower.routeProgress, progress) * routeLength
  const toUpperMeters =
    forwardProgressDistance(progress, upper.routeProgress) * routeLength
  const lowerWeight =
    fromLowerMeters < edgeBlendMeters
      ? smoothstep01(1 - fromLowerMeters / edgeBlendMeters)
      : 0
  const upperWeight =
    toUpperMeters < edgeBlendMeters
      ? smoothstep01(1 - toUpperMeters / edgeBlendMeters)
      : 0
  const totalWeight = lowerWeight + upperWeight
  if (totalWeight <= 0) return null
  return {
    offsetMeters:
      (lower.offsetMeters * lowerWeight + upper.offsetMeters * upperWeight) /
      totalWeight,
    weight: Math.min(1, totalWeight),
  }
}

export function createAuthoredLineSampler(
  points: readonly AuthoredLinePoint[],
  curveLengthMeters: number,
  maximumGapMeters = AUTHORED_LINE_MAXIMUM_GAP_METERS,
  edgeBlendMeters = AUTHORED_LINE_EDGE_BLEND_METERS,
) {
  const sorted = normalizeAuthoredLinePoints(points)
  return (routeProgress: number) =>
    sampleNormalizedAuthoredLineAtProgress(
      sorted,
      routeProgress,
      curveLengthMeters,
      maximumGapMeters,
      edgeBlendMeters,
    )
}

export function sampleAuthoredLineAtProgress(
  points: readonly AuthoredLinePoint[],
  routeProgress: number,
  curveLengthMeters: number,
  maximumGapMeters = AUTHORED_LINE_MAXIMUM_GAP_METERS,
  edgeBlendMeters = AUTHORED_LINE_EDGE_BLEND_METERS,
) {
  return createAuthoredLineSampler(
    points,
    curveLengthMeters,
    maximumGapMeters,
    edgeBlendMeters,
  )(routeProgress)
}

function coalesceTake(points: readonly AuthoredLinePoint[]) {
  const take: AuthoredLinePoint[] = []
  for (const value of points) {
    const point = sanitizePoint(value)
    if (!point) continue
    const previous = take[take.length - 1]
    if (
      previous &&
      cyclicProgressDistance(previous.routeProgress, point.routeProgress) <=
        DUPLICATE_PROGRESS_TOLERANCE
    ) {
      take[take.length - 1] = point
    } else {
      take.push(point)
    }
  }
  return take
}

/** Replace only the forward route interval covered by a new punch-in take. */
export function mergeAuthoredLineTake(
  existing: readonly AuthoredLinePoint[],
  recordedTake: readonly AuthoredLinePoint[],
) {
  const take = coalesceTake(recordedTake)
  if (take.length === 0) return normalizeAuthoredLinePoints(existing)
  if (take.length === 1) {
    return upsertAuthoredLinePoint(
      existing,
      take[0],
      DUPLICATE_PROGRESS_TOLERANCE,
    )
  }

  let coveredProgress = 0
  for (let index = 1; index < take.length; index += 1) {
    coveredProgress += forwardProgressDistance(
      take[index - 1].routeProgress,
      take[index].routeProgress,
    )
  }
  if (coveredProgress >= 0.995) return normalizeAuthoredLinePoints(take)

  const startProgress = take[0].routeProgress
  const retained = normalizeAuthoredLinePoints(existing).filter((point) => {
    const distance = forwardProgressDistance(
      startProgress,
      point.routeProgress,
    )
    return distance > coveredProgress + DUPLICATE_PROGRESS_TOLERANCE
  })
  return normalizeAuthoredLinePoints([...retained, ...take])
}

export function upsertAuthoredLinePoint(
  points: readonly AuthoredLinePoint[],
  value: AuthoredLinePoint,
  toleranceProgress = 0.00075,
) {
  const point = sanitizePoint(value)
  if (!point) return normalizeAuthoredLinePoints(points)
  const next = normalizeAuthoredLinePoints(points)
  const existingIndex = next.findIndex(
    (candidate) =>
      cyclicProgressDistance(candidate.routeProgress, point.routeProgress) <=
      toleranceProgress,
  )
  if (existingIndex >= 0) next[existingIndex] = point
  else next.push(point)
  return normalizeAuthoredLinePoints(next)
}

export function nearestAuthoredLinePoint(
  points: readonly AuthoredLinePoint[],
  routeProgress: number,
  toleranceProgress = 0.001,
) {
  let nearest: AuthoredLinePoint | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const value of points) {
    const point = sanitizePoint(value)
    if (!point) continue
    const distance = cyclicProgressDistance(point.routeProgress, routeProgress)
    if (distance < nearestDistance) {
      nearest = point
      nearestDistance = distance
    }
  }
  return nearest && nearestDistance <= toleranceProgress
    ? { point: nearest, distanceProgress: nearestDistance }
    : null
}

export function removeNearestAuthoredLinePoint(
  points: readonly AuthoredLinePoint[],
  routeProgress: number,
  toleranceProgress = 0.001,
) {
  const next = normalizeAuthoredLinePoints(points)
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < next.length; index += 1) {
    const distance = cyclicProgressDistance(
      next[index].routeProgress,
      routeProgress,
    )
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }
  if (nearestIndex < 0 || nearestDistance > toleranceProgress) return next
  next.splice(nearestIndex, 1)
  return next
}

export function authoredLineCoverage(
  points: readonly AuthoredLinePoint[],
  curveLengthMeters: number,
  maximumGapMeters = AUTHORED_LINE_MAXIMUM_GAP_METERS,
) {
  const sorted = normalizeAuthoredLinePoints(points)
  if (sorted.length < 2 || curveLengthMeters <= 0) return 0
  let coveredProgress = 0
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    const next = sorted[(index + 1) % sorted.length]
    const gap = forwardProgressDistance(
      current.routeProgress,
      next.routeProgress,
    )
    if (gap * curveLengthMeters <= maximumGapMeters) coveredProgress += gap
  }
  return clamp(coveredProgress, 0, 1)
}

export function serializeAuthoredRacingLine(
  points: readonly AuthoredLinePoint[],
) {
  const payload: AuthoredRacingLine = {
    schemaVersion: 1,
    replayKey: AUTHORED_LINE_REPLAY_KEY,
    routeVersion: AUTHORED_LINE_ROUTE_VERSION,
    points: normalizeAuthoredLinePoints(points),
  }
  return JSON.stringify(payload, null, 2)
}

export function readStoredAuthoredLine() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(AUTHORED_LINE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const payload = parsed as Partial<AuthoredRacingLine>
    if (
      payload.schemaVersion !== 1 ||
      payload.replayKey !== AUTHORED_LINE_REPLAY_KEY ||
      payload.routeVersion !== AUTHORED_LINE_ROUTE_VERSION ||
      !Array.isArray(payload.points)
    ) {
      return []
    }
    return normalizeAuthoredLinePoints(payload.points)
  } catch {
    return []
  }
}

export function storeAuthoredLine(points: readonly AuthoredLinePoint[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    AUTHORED_LINE_STORAGE_KEY,
    serializeAuthoredRacingLine(points),
  )
}
