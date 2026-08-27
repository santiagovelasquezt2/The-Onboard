export type RacingLineAnchor = {
  lapTimeSeconds: number
  /** Signed correction from the authored groove: negative left, positive right. */
  deltaMeters: number
}

export const RACING_LINE_STORAGE_KEY =
  'theonboard:montreal:racing-line:v7-driving-line'

const MAXIMUM_DELTA_METERS = 6

const clampDelta = (value: number) =>
  Math.min(MAXIMUM_DELTA_METERS, Math.max(-MAXIMUM_DELTA_METERS, value))

function wrapLapTime(seconds: number, durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return seconds
  return ((seconds % durationSeconds) + durationSeconds) % durationSeconds
}

export function normalizeRacingLineAnchors(
  anchors: readonly RacingLineAnchor[],
  durationSeconds: number,
): RacingLineAnchor[] {
  return anchors
    .filter(
      (anchor) =>
        Number.isFinite(anchor.lapTimeSeconds) &&
        Number.isFinite(anchor.deltaMeters),
    )
    .map((anchor) => ({
      lapTimeSeconds: wrapLapTime(anchor.lapTimeSeconds, durationSeconds),
      deltaMeters: clampDelta(anchor.deltaMeters),
    }))
    .sort((a, b) => a.lapTimeSeconds - b.lapTimeSeconds)
}

export function racingLineDeltaAtLapTime(
  anchors: readonly RacingLineAnchor[],
  lapTimeSeconds: number,
  durationSeconds: number,
) {
  const sorted = normalizeRacingLineAnchors(anchors, durationSeconds)
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0].deltaMeters

  const sampleTime = wrapLapTime(lapTimeSeconds, durationSeconds)
  let upperIndex = sorted.findIndex(
    (anchor) => anchor.lapTimeSeconds > sampleTime,
  )
  if (upperIndex < 0) upperIndex = 0
  const lowerIndex = (upperIndex - 1 + sorted.length) % sorted.length
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]
  const wraps = upperIndex === 0
  const lowerTime = lower.lapTimeSeconds
  const upperTime = wraps
    ? upper.lapTimeSeconds + durationSeconds
    : upper.lapTimeSeconds
  const adjustedSampleTime =
    wraps && sampleTime < upper.lapTimeSeconds
      ? sampleTime + durationSeconds
      : sampleTime
  const span = upperTime - lowerTime
  const linearAlpha = span > 1e-9 ? (adjustedSampleTime - lowerTime) / span : 0
  const alpha = Math.min(1, Math.max(0, linearAlpha))
  const easedAlpha = alpha * alpha * (3 - 2 * alpha)
  return (
    lower.deltaMeters + (upper.deltaMeters - lower.deltaMeters) * easedAlpha
  )
}

function cyclicTimeDistance(
  first: number,
  second: number,
  durationSeconds: number,
) {
  const direct = Math.abs(first - second)
  return Math.min(direct, Math.max(0, durationSeconds - direct))
}

export function upsertRacingLineAnchor(
  anchors: readonly RacingLineAnchor[],
  lapTimeSeconds: number,
  deltaMeters: number,
  durationSeconds: number,
  mergeToleranceSeconds = 0.2,
) {
  const next = normalizeRacingLineAnchors(anchors, durationSeconds)
  const wrappedTime = wrapLapTime(lapTimeSeconds, durationSeconds)
  const existingIndex = next.findIndex(
    (anchor) =>
      cyclicTimeDistance(anchor.lapTimeSeconds, wrappedTime, durationSeconds) <=
      mergeToleranceSeconds,
  )
  const anchor = {
    lapTimeSeconds: wrappedTime,
    deltaMeters: clampDelta(deltaMeters),
  }
  if (existingIndex >= 0) next[existingIndex] = anchor
  else next.push(anchor)
  return normalizeRacingLineAnchors(next, durationSeconds)
}

export function removeNearestRacingLineAnchor(
  anchors: readonly RacingLineAnchor[],
  lapTimeSeconds: number,
  durationSeconds: number,
  toleranceSeconds = 0.4,
) {
  const next = normalizeRacingLineAnchors(anchors, durationSeconds)
  const wrappedTime = wrapLapTime(lapTimeSeconds, durationSeconds)
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < next.length; index += 1) {
    const distance = cyclicTimeDistance(
      next[index].lapTimeSeconds,
      wrappedTime,
      durationSeconds,
    )
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  if (bestIndex < 0 || bestDistance > toleranceSeconds) return next
  next.splice(bestIndex, 1)
  return next
}

export function nearestRacingLineAnchor(
  anchors: readonly RacingLineAnchor[],
  lapTimeSeconds: number,
  durationSeconds: number,
  toleranceSeconds = 0.4,
) {
  const wrappedTime = wrapLapTime(lapTimeSeconds, durationSeconds)
  let best: RacingLineAnchor | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const anchor of normalizeRacingLineAnchors(anchors, durationSeconds)) {
    const distance = cyclicTimeDistance(
      anchor.lapTimeSeconds,
      wrappedTime,
      durationSeconds,
    )
    if (distance < bestDistance) {
      best = anchor
      bestDistance = distance
    }
  }
  return best && bestDistance <= toleranceSeconds
    ? { anchor: best, distanceSeconds: bestDistance }
    : null
}

export function readStoredRacingLineAnchors(
  fallback: readonly RacingLineAnchor[],
  durationSeconds: number,
) {
  try {
    const raw = window.localStorage.getItem(RACING_LINE_STORAGE_KEY)
    if (!raw) return normalizeRacingLineAnchors(fallback, durationSeconds)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return normalizeRacingLineAnchors(fallback, durationSeconds)
    }
    return normalizeRacingLineAnchors(
      parsed.filter(
        (value): value is RacingLineAnchor =>
          typeof value === 'object' &&
          value !== null &&
          'lapTimeSeconds' in value &&
          'deltaMeters' in value &&
          typeof value.lapTimeSeconds === 'number' &&
          typeof value.deltaMeters === 'number',
      ),
      durationSeconds,
    )
  } catch {
    return normalizeRacingLineAnchors(fallback, durationSeconds)
  }
}

export function storeRacingLineAnchors(anchors: readonly RacingLineAnchor[]) {
  window.localStorage.setItem(RACING_LINE_STORAGE_KEY, JSON.stringify(anchors))
}
