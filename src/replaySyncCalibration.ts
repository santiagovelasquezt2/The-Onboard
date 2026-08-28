export type ReplaySyncAnchor = {
  lapTimeSeconds: number
  /** Added to the base route clock at this video/lap time. */
  offsetSeconds: number
}

export const REPLAY_SYNC_STORAGE_KEY =
  'theonboard:montreal:replay-sync-checkpoints:v1'

const MAXIMUM_OFFSET_SECONDS = 2
const MAXIMUM_OFFSET_SLOPE = 0.45
const MERGE_TOLERANCE_SECONDS = 0.08
const ENDPOINT_GUARD_SECONDS = 0.25

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function sanitizeAnchor(
  value: unknown,
  durationSeconds: number,
): ReplaySyncAnchor | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ReplaySyncAnchor>
  if (
    typeof candidate.lapTimeSeconds !== 'number' ||
    !Number.isFinite(candidate.lapTimeSeconds) ||
    typeof candidate.offsetSeconds !== 'number' ||
    !Number.isFinite(candidate.offsetSeconds)
  ) {
    return null
  }
  const duration = Math.max(0, durationSeconds)
  return {
    lapTimeSeconds: clamp(
      candidate.lapTimeSeconds,
      Math.min(ENDPOINT_GUARD_SECONDS, duration * 0.25),
      Math.max(
        Math.min(ENDPOINT_GUARD_SECONDS, duration * 0.25),
        duration - Math.min(ENDPOINT_GUARD_SECONDS, duration * 0.25),
      ),
    ),
    offsetSeconds: clamp(
      candidate.offsetSeconds,
      -MAXIMUM_OFFSET_SECONDS,
      MAXIMUM_OFFSET_SECONDS,
    ),
  }
}

/**
 * Keep adjacent checkpoint offsets gentle enough that mapped route time always
 * moves forward. Implicit zero-offset endpoints preserve the calibrated seam.
 */
export function normalizeReplaySyncAnchors(
  anchors: readonly ReplaySyncAnchor[],
  durationSeconds: number,
) {
  const duration = Math.max(0, durationSeconds)
  if (duration <= 0) return []
  const sorted = anchors
    .map((anchor) => sanitizeAnchor(anchor, duration))
    .filter((anchor): anchor is ReplaySyncAnchor => anchor !== null)
    .sort((first, second) => first.lapTimeSeconds - second.lapTimeSeconds)
  const deduplicated: ReplaySyncAnchor[] = []
  for (const anchor of sorted) {
    const previous = deduplicated[deduplicated.length - 1]
    if (
      previous &&
      Math.abs(anchor.lapTimeSeconds - previous.lapTimeSeconds) <=
        MERGE_TOLERANCE_SECONDS
    ) {
      deduplicated[deduplicated.length - 1] = anchor
    } else {
      deduplicated.push(anchor)
    }
  }

  const constrained = [
    { lapTimeSeconds: 0, offsetSeconds: 0 },
    ...deduplicated,
    { lapTimeSeconds: duration, offsetSeconds: 0 },
  ]
  for (let pass = 0; pass < 4; pass += 1) {
    for (let index = 1; index < constrained.length - 1; index += 1) {
      const previous = constrained[index - 1]
      const current = constrained[index]
      const maximumChange =
        (current.lapTimeSeconds - previous.lapTimeSeconds) *
        MAXIMUM_OFFSET_SLOPE
      current.offsetSeconds = clamp(
        current.offsetSeconds,
        previous.offsetSeconds - maximumChange,
        previous.offsetSeconds + maximumChange,
      )
    }
    for (let index = constrained.length - 2; index >= 1; index -= 1) {
      const current = constrained[index]
      const next = constrained[index + 1]
      const maximumChange =
        (next.lapTimeSeconds - current.lapTimeSeconds) *
        MAXIMUM_OFFSET_SLOPE
      current.offsetSeconds = clamp(
        current.offsetSeconds,
        next.offsetSeconds - maximumChange,
        next.offsetSeconds + maximumChange,
      )
    }
  }
  return constrained.slice(1, -1)
}

export function replaySyncOffsetAtLapTime(
  anchors: readonly ReplaySyncAnchor[],
  lapTimeSeconds: number,
  durationSeconds: number,
) {
  const duration = Math.max(0, durationSeconds)
  if (duration <= 0 || lapTimeSeconds <= 0 || lapTimeSeconds >= duration) {
    return 0
  }
  const normalized = normalizeReplaySyncAnchors(anchors, duration)
  const points = [
    { lapTimeSeconds: 0, offsetSeconds: 0 },
    ...normalized,
    { lapTimeSeconds: duration, offsetSeconds: 0 },
  ]
  const upperIndex = points.findIndex(
    (point) => point.lapTimeSeconds >= lapTimeSeconds,
  )
  if (upperIndex <= 0) return points[0].offsetSeconds
  const lower = points[upperIndex - 1]
  const upper = points[upperIndex]
  const span = upper.lapTimeSeconds - lower.lapTimeSeconds
  const linearAlpha =
    span > 1e-9 ? (lapTimeSeconds - lower.lapTimeSeconds) / span : 0
  const alpha = clamp(linearAlpha, 0, 1)
  const easedAlpha = alpha * alpha * (3 - 2 * alpha)
  return (
    lower.offsetSeconds +
    (upper.offsetSeconds - lower.offsetSeconds) * easedAlpha
  )
}

export function upsertReplaySyncAnchor(
  anchors: readonly ReplaySyncAnchor[],
  lapTimeSeconds: number,
  offsetSeconds: number,
  durationSeconds: number,
) {
  const next = normalizeReplaySyncAnchors(anchors, durationSeconds)
  const anchor = sanitizeAnchor(
    { lapTimeSeconds, offsetSeconds },
    durationSeconds,
  )
  if (!anchor) return next
  const existingIndex = next.findIndex(
    (candidate) =>
      Math.abs(candidate.lapTimeSeconds - anchor.lapTimeSeconds) <=
      MERGE_TOLERANCE_SECONDS,
  )
  if (existingIndex >= 0) next[existingIndex] = anchor
  else next.push(anchor)
  return normalizeReplaySyncAnchors(next, durationSeconds)
}

export function nearestReplaySyncAnchor(
  anchors: readonly ReplaySyncAnchor[],
  lapTimeSeconds: number,
  durationSeconds: number,
  toleranceSeconds = 0.3,
) {
  let nearest: ReplaySyncAnchor | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const anchor of normalizeReplaySyncAnchors(anchors, durationSeconds)) {
    const candidateDistance = Math.abs(
      anchor.lapTimeSeconds - lapTimeSeconds,
    )
    if (candidateDistance < distance) {
      nearest = anchor
      distance = candidateDistance
    }
  }
  return nearest && distance <= toleranceSeconds
    ? { anchor: nearest, distanceSeconds: distance }
    : null
}

export function removeNearestReplaySyncAnchor(
  anchors: readonly ReplaySyncAnchor[],
  lapTimeSeconds: number,
  durationSeconds: number,
) {
  const next = normalizeReplaySyncAnchors(anchors, durationSeconds)
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < next.length; index += 1) {
    const distance = Math.abs(next[index].lapTimeSeconds - lapTimeSeconds)
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }
  if (nearestIndex < 0 || nearestDistance > 0.3) return next
  next.splice(nearestIndex, 1)
  return next
}

export function readStoredReplaySyncAnchors(durationSeconds: number) {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(REPLAY_SYNC_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeReplaySyncAnchors(
      parsed as ReplaySyncAnchor[],
      durationSeconds,
    )
  } catch {
    return []
  }
}

export function storeReplaySyncAnchors(
  anchors: readonly ReplaySyncAnchor[],
  durationSeconds: number,
) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    REPLAY_SYNC_STORAGE_KEY,
    JSON.stringify(
      normalizeReplaySyncAnchors(anchors, durationSeconds),
      null,
      2,
    ),
  )
}
