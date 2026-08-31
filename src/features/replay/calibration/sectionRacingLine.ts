import {
  AUTHORED_LINE_REPLAY_KEY,
  AUTHORED_LINE_ROUTE_VERSION,
  cyclicProgressDistance,
  normalizeAuthoredLinePoints,
  type AuthoredLinePoint,
} from './authoredRacingLine.ts'
import { CALIBRATION_SECTIONS } from './calibrationSections.ts'

export type SectionLineTake = {
  /** Stable section id from `CALIBRATION_SECTIONS`. */
  sectionId: string
  /**
   * Capture order, including the section entry and exit. Do not sort this
   * array: a section can cross the wrapped replay-route seam.
   */
  points: AuthoredLinePoint[]
}

export type SectionRacingLine = {
  schemaVersion: 1
  replayKey: typeof AUTHORED_LINE_REPLAY_KEY
  routeVersion: typeof AUTHORED_LINE_ROUTE_VERSION
  sectionSetVersion: typeof SECTION_RACING_LINE_SET_VERSION
  takes: SectionLineTake[]
}

export type SectionTakeEntry =
  | { mode: 'inherit' }
  | { mode: 'manual'; offsetMeters: number }

export const SECTION_RACING_LINE_SET_VERSION = 'montreal-practical-9-v1'
export const SECTION_RACING_LINE_STORAGE_KEY =
  'theonboard:montreal:section-racing-line:v1'

const MAXIMUM_ABSOLUTE_OFFSET_METERS = 24
const DUPLICATE_PROGRESS_TOLERANCE = 1e-6
const ORDERED_SECTION_IDS = CALIBRATION_SECTIONS.map((section) => section.id)

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function wrap01(value: number) {
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
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

/** Sanitize repeated samples without losing their chronological order. */
function coalesceCapturedTake(points: readonly AuthoredLinePoint[]) {
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

function sectionIndex(sectionId: string) {
  return ORDERED_SECTION_IDS.indexOf(sectionId)
}

function cloneTake(take: SectionLineTake): SectionLineTake {
  return {
    sectionId: take.sectionId,
    points: take.points.map((point) => ({ ...point })),
  }
}

function normalizeTakes(takes: readonly SectionLineTake[]) {
  const bySectionId = new Map<string, SectionLineTake>()
  for (const candidate of takes) {
    if (!candidate || sectionIndex(candidate.sectionId) < 0) continue
    const points = coalesceCapturedTake(candidate.points)
    if (points.length === 0) continue
    bySectionId.set(candidate.sectionId, {
      sectionId: candidate.sectionId,
      points,
    })
  }
  return ORDERED_SECTION_IDS.flatMap((sectionId) => {
    const take = bySectionId.get(sectionId)
    return take ? [take] : []
  })
}

function getPredecessorId(sectionId: string) {
  const index = sectionIndex(sectionId)
  if (index < 0) return null
  return ORDERED_SECTION_IDS[
    (index - 1 + ORDERED_SECTION_IDS.length) % ORDERED_SECTION_IDS.length
  ]
}

function getSuccessorId(sectionId: string) {
  const index = sectionIndex(sectionId)
  if (index < 0) return null
  return ORDERED_SECTION_IDS[(index + 1) % ORDERED_SECTION_IDS.length]
}

function lastPoint(take: SectionLineTake | undefined) {
  return take?.points[take.points.length - 1] ?? null
}

export function readStoredSectionRacingLine() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SECTION_RACING_LINE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<SectionRacingLine>
    if (
      parsed.schemaVersion !== 1 ||
      parsed.replayKey !== AUTHORED_LINE_REPLAY_KEY ||
      parsed.routeVersion !== AUTHORED_LINE_ROUTE_VERSION ||
      parsed.sectionSetVersion !== SECTION_RACING_LINE_SET_VERSION ||
      !Array.isArray(parsed.takes)
    ) {
      return []
    }
    return normalizeTakes(parsed.takes)
  } catch {
    return []
  }
}

export function storeSectionRacingLine(takes: readonly SectionLineTake[]) {
  if (typeof window === 'undefined') return
  const payload: SectionRacingLine = {
    schemaVersion: 1,
    replayKey: AUTHORED_LINE_REPLAY_KEY,
    routeVersion: AUTHORED_LINE_ROUTE_VERSION,
    sectionSetVersion: SECTION_RACING_LINE_SET_VERSION,
    takes: normalizeTakes(takes),
  }
  try {
    window.localStorage.setItem(
      SECTION_RACING_LINE_STORAGE_KEY,
      JSON.stringify(payload),
    )
  } catch {
    // Local calibration remains usable for this tab if browser storage is off.
  }
}

export function getSectionLineTake(
  takes: readonly SectionLineTake[],
  sectionId: string,
) {
  const found = takes.find((take) => take.sectionId === sectionId)
  return found ? cloneTake(found) : null
}

/**
 * The only valid inherited entry is the immediately preceding section's exit.
 * This prevents a skipped chunk from producing a long, artificial connection.
 */
export function inheritedSectionEntry(
  takes: readonly SectionLineTake[],
  sectionId: string,
) {
  const predecessorId = getPredecessorId(sectionId)
  if (!predecessorId) return null
  return lastPoint(takes.find((take) => take.sectionId === predecessorId))
}

export function sectionHasTake(
  takes: readonly SectionLineTake[],
  sectionId: string,
) {
  return Boolean(getSectionLineTake(takes, sectionId))
}

/**
 * Atomically replace one section and stitch the shared boundaries on both
 * sides. The renderer keeps receiving the same flat authored-line contract.
 */
export function replaceSectionLineTake(
  existing: readonly SectionLineTake[],
  sectionId: string,
  capturedPoints: readonly AuthoredLinePoint[],
  entry: SectionTakeEntry = { mode: 'inherit' },
) {
  if (sectionIndex(sectionId) < 0) return normalizeTakes(existing)
  const currentPoints = coalesceCapturedTake(capturedPoints)
  if (currentPoints.length === 0) return normalizeTakes(existing)

  const bySectionId = new Map(
    normalizeTakes(existing).map((take) => [take.sectionId, cloneTake(take)]),
  )
  const predecessorId = getPredecessorId(sectionId)
  const predecessor = predecessorId
    ? bySectionId.get(predecessorId)
    : undefined
  const predecessorExit = lastPoint(predecessor)

  const resolvedEntry =
    entry.mode === 'manual'
      ? clamp(
          entry.offsetMeters,
          -MAXIMUM_ABSOLUTE_OFFSET_METERS,
          MAXIMUM_ABSOLUTE_OFFSET_METERS,
        )
      : predecessorExit?.offsetMeters

  if (typeof resolvedEntry === 'number') {
    currentPoints[0] = {
      ...currentPoints[0],
      offsetMeters: resolvedEntry,
    }
    if (predecessor) {
      const exitIndex = predecessor.points.length - 1
      predecessor.points[exitIndex] = {
        ...predecessor.points[exitIndex],
        offsetMeters: resolvedEntry,
      }
    }
  }

  const current: SectionLineTake = {
    sectionId,
    points: currentPoints,
  }
  bySectionId.set(sectionId, current)

  const successorId = getSuccessorId(sectionId)
  const successor = successorId ? bySectionId.get(successorId) : undefined
  const currentExit = lastPoint(current)
  if (successor && currentExit) {
    successor.points[0] = {
      ...successor.points[0],
      offsetMeters: currentExit.offsetMeters,
    }
  }

  return normalizeTakes(
    ORDERED_SECTION_IDS.flatMap((id) => {
      const take = bySectionId.get(id)
      return take ? [take] : []
    }),
  )
}

export function flattenSectionLineTakes(takes: readonly SectionLineTake[]) {
  return normalizeAuthoredLinePoints(
    normalizeTakes(takes).flatMap((take) => take.points),
  )
}
