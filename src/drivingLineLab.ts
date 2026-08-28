import {
  AUTHORED_LINE_REPLAY_KEY,
  AUTHORED_LINE_ROUTE_VERSION,
  cyclicProgressDistance,
  type AuthoredLinePoint,
} from './authoredRacingLine.ts'

export const DRIVING_LINE_LAB_STORAGE_KEY =
  'theonboard:montreal:driving-line-lab:v1'
export const DRIVING_LINE_LAB_CORRIDOR_VERSION = 'montreal-corridor-v1'
export const DRIVING_LINE_LAB_FITTER_VERSION = 'local-influence-v1'
export const DRIVING_LINE_LAB_DEFAULT_CONTACT_SLOT_COUNT = 28
export const DRIVING_LINE_LAB_CONTACT_SLOT_COUNT =
  DRIVING_LINE_LAB_DEFAULT_CONTACT_SLOT_COUNT
export const DRIVING_LINE_LAB_MINIMUM_CONTACT_SLOT_COUNT = 1
export const DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT = 128

export type DrivingLineSurface = 'white-line' | 'curb' | 'ref-point'
export type DrivingLineRouteSide = 'route-left' | 'route-right'
export type DrivingLineContactSlot = number

export type DrivingLineMark = {
  id: string
  contactSlot: DrivingLineContactSlot
  routeProgress: number
  offsetMeters: number
  sourceLapTimeSeconds: number
  minimumOffsetMeters: number
  maximumOffsetMeters: number
  roadFraction: number
  side: DrivingLineRouteSide
  surface: DrivingLineSurface
  toleranceMeters: number
  createdAt: string
}

export type DrivingLineRun = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  contactSlotCount: number
  marks: DrivingLineMark[]
}

export type DrivingLineLabDocument = {
  schemaVersion: 1
  replayKey: typeof AUTHORED_LINE_REPLAY_KEY
  routeVersion: typeof AUTHORED_LINE_ROUTE_VERSION
  corridorVersion: typeof DRIVING_LINE_LAB_CORRIDOR_VERSION
  fitterVersion: typeof DRIVING_LINE_LAB_FITTER_VERSION
  selectedRunId: string
  runs: DrivingLineRun[]
}

export type NewDrivingLineMark = Omit<
  DrivingLineMark,
  'id' | 'createdAt' | 'contactSlot'
> & {
  id?: string
  createdAt?: string
  contactSlot?: DrivingLineContactSlot
}

export type DrivingLineMarkUndo = {
  runId: string
  previousRun: DrivingLineRun
}

const MAXIMUM_ABSOLUTE_OFFSET_METERS = 24
const DUPLICATE_MARK_PROGRESS_TOLERANCE = 0.00002

type MigratableDrivingLineMark = Omit<DrivingLineMark, 'contactSlot'> & {
  contactSlot: DrivingLineContactSlot | null
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function wrap01(value: number) {
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function claimUniqueId(id: string, claimedIds: Set<string>) {
  if (!claimedIds.has(id)) {
    claimedIds.add(id)
    return id
  }

  let suffix = 2
  let candidate = `${id}-${suffix}`
  while (claimedIds.has(candidate)) {
    suffix += 1
    candidate = `${id}-${suffix}`
  }
  claimedIds.add(candidate)
  return candidate
}

function finiteNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : null
}

function validIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null
}

function validContactSlot(value: unknown): value is DrivingLineContactSlot {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT
  )
}

function validContactSlotCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= DRIVING_LINE_LAB_MINIMUM_CONTACT_SLOT_COUNT &&
    value <= DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT
  )
}

function sanitizeMark(value: unknown): MigratableDrivingLineMark | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DrivingLineMark>
  const routeProgress = finiteNumber(
    candidate.routeProgress,
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  )
  const offsetMeters = finiteNumber(
    candidate.offsetMeters,
    -MAXIMUM_ABSOLUTE_OFFSET_METERS,
    MAXIMUM_ABSOLUTE_OFFSET_METERS,
  )
  const sourceLapTimeSeconds = finiteNumber(
    candidate.sourceLapTimeSeconds,
    0,
    24 * 60 * 60,
  )
  const minimumOffsetMeters = finiteNumber(
    candidate.minimumOffsetMeters,
    -MAXIMUM_ABSOLUTE_OFFSET_METERS,
    MAXIMUM_ABSOLUTE_OFFSET_METERS,
  )
  const maximumOffsetMeters = finiteNumber(
    candidate.maximumOffsetMeters,
    -MAXIMUM_ABSOLUTE_OFFSET_METERS,
    MAXIMUM_ABSOLUTE_OFFSET_METERS,
  )
  const roadFraction = finiteNumber(candidate.roadFraction, 0, 1)
  const toleranceMeters = finiteNumber(candidate.toleranceMeters, 0.01, 5)
  const createdAt = validIsoDate(candidate.createdAt)
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    routeProgress === null ||
    offsetMeters === null ||
    sourceLapTimeSeconds === null ||
    minimumOffsetMeters === null ||
    maximumOffsetMeters === null ||
    minimumOffsetMeters > maximumOffsetMeters ||
    roadFraction === null ||
    toleranceMeters === null ||
    createdAt === null ||
    (candidate.side !== 'route-left' && candidate.side !== 'route-right') ||
    (candidate.surface !== 'white-line' &&
      candidate.surface !== 'curb' &&
      candidate.surface !== 'ref-point')
  ) {
    return null
  }

  if (
    offsetMeters < minimumOffsetMeters - 1e-6 ||
    offsetMeters > maximumOffsetMeters + 1e-6
  ) {
    return null
  }
  const width = maximumOffsetMeters - minimumOffsetMeters
  const derivedRoadFraction =
    width > 1e-9
      ? clamp((offsetMeters - minimumOffsetMeters) / width, 0, 1)
      : roadFraction

  return {
    id: candidate.id,
    contactSlot: validContactSlot(candidate.contactSlot)
      ? candidate.contactSlot
      : null,
    routeProgress: wrap01(routeProgress),
    offsetMeters,
    sourceLapTimeSeconds,
    minimumOffsetMeters,
    maximumOffsetMeters,
    roadFraction: derivedRoadFraction,
    side: derivedRoadFraction < 0.5 ? 'route-left' : 'route-right',
    surface: candidate.surface,
    toleranceMeters,
    createdAt,
  }
}

function normalizeRunMarks(
  values: readonly unknown[],
  contactSlotCount: number,
) {
  const sanitized = values
    .map(sanitizeMark)
    .filter((mark): mark is MigratableDrivingLineMark => mark !== null)
  const chronological = [...sanitized]
    .sort((first, second) => {
      const timeDifference =
        Date.parse(first.createdAt) - Date.parse(second.createdAt)
      return timeDifference !== 0
        ? timeDifference
        : first.id.localeCompare(second.id)
    })

  // Explicit slots are authoritative. Processing chronologically means a
  // later persisted update to the same slot replaces the earlier value.
  const bySlot = new Map<DrivingLineContactSlot, DrivingLineMark>()
  for (const mark of chronological) {
    if (mark.contactSlot === null || mark.contactSlot > contactSlotCount) {
      continue
    }
    bySlot.set(mark.contactSlot, {
      ...mark,
      contactSlot: mark.contactSlot,
    })
  }

  // Legacy v1 marks had no slot. Reserve every explicit slot first, then
  // migrate legacy contacts in lap order so the result does not depend on the
  // old array order and no valid contact is displaced by a partial migration.
  const availableSlots = Array.from(
    { length: contactSlotCount },
    (_, index) => (index + 1) as DrivingLineContactSlot,
  ).filter((slot) => !bySlot.has(slot))
  const legacyMarks = sanitized
    .filter((mark) => mark.contactSlot === null)
    .sort((first, second) => {
      const lapTimeDifference =
        first.sourceLapTimeSeconds - second.sourceLapTimeSeconds
      if (lapTimeDifference !== 0) return lapTimeDifference
      const progressDifference = first.routeProgress - second.routeProgress
      if (progressDifference !== 0) return progressDifference
      const timeDifference =
        Date.parse(first.createdAt) - Date.parse(second.createdAt)
      return timeDifference !== 0
        ? timeDifference
        : first.id.localeCompare(second.id)
    })
  for (const mark of legacyMarks) {
    const contactSlot = availableSlots.shift()
    if (contactSlot === undefined) break
    bySlot.set(contactSlot, { ...mark, contactSlot })
  }

  return [...bySlot.values()].sort(
    (first, second) => first.contactSlot - second.contactSlot,
  )
}

function sanitizeRun(value: unknown): DrivingLineRun | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DrivingLineRun>
  const createdAt = validIsoDate(candidate.createdAt)
  const updatedAt = validIsoDate(candidate.updatedAt)
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    !createdAt ||
    !updatedAt ||
    !Array.isArray(candidate.marks)
  ) {
    return null
  }

  const largestExplicitSlot = candidate.marks.reduce((largest, mark) => {
    if (!mark || typeof mark !== 'object') return largest
    const slot = (mark as Partial<DrivingLineMark>).contactSlot
    return validContactSlot(slot) ? Math.max(largest, slot) : largest
  }, 0)
  const requestedContactSlotCount = validContactSlotCount(
    candidate.contactSlotCount,
  )
    ? candidate.contactSlotCount
    : DRIVING_LINE_LAB_DEFAULT_CONTACT_SLOT_COUNT
  const contactSlotCount = Math.min(
    DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT,
    Math.max(requestedContactSlotCount, largestExplicitSlot),
  )

  return {
    id: candidate.id,
    name: candidate.name.trim().slice(0, 80),
    createdAt,
    updatedAt,
    contactSlotCount,
    marks: normalizeRunMarks(candidate.marks, contactSlotCount),
  }
}

export function createDrivingLineRun(
  runNumber: number,
  now = new Date().toISOString(),
  id = createId('contact-pass'),
): DrivingLineRun {
  return {
    id,
    name: `Contact pass ${Math.max(1, Math.floor(runNumber))}`,
    createdAt: now,
    updatedAt: now,
    contactSlotCount: DRIVING_LINE_LAB_DEFAULT_CONTACT_SLOT_COUNT,
    marks: [],
  }
}

export function createDrivingLineLabDocument(
  now = new Date().toISOString(),
  runId?: string,
): DrivingLineLabDocument {
  const firstRun = createDrivingLineRun(1, now, runId)
  return {
    schemaVersion: 1,
    replayKey: AUTHORED_LINE_REPLAY_KEY,
    routeVersion: AUTHORED_LINE_ROUTE_VERSION,
    corridorVersion: DRIVING_LINE_LAB_CORRIDOR_VERSION,
    fitterVersion: DRIVING_LINE_LAB_FITTER_VERSION,
    selectedRunId: firstRun.id,
    runs: [firstRun],
  }
}

export function sanitizeDrivingLineLabDocument(
  value: unknown,
): DrivingLineLabDocument | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DrivingLineLabDocument>
  if (
    candidate.schemaVersion !== 1 ||
    candidate.replayKey !== AUTHORED_LINE_REPLAY_KEY ||
    candidate.routeVersion !== AUTHORED_LINE_ROUTE_VERSION ||
    candidate.corridorVersion !== DRIVING_LINE_LAB_CORRIDOR_VERSION ||
    candidate.fitterVersion !== DRIVING_LINE_LAB_FITTER_VERSION ||
    !Array.isArray(candidate.runs)
  ) {
    return null
  }
  const sanitizedRuns = candidate.runs
    .map(sanitizeRun)
    .filter((run): run is DrivingLineRun => run !== null)
  const claimedRunIds = new Set<string>()
  const runs = sanitizedRuns.map((run) => {
    const id = claimUniqueId(run.id, claimedRunIds)
    return id === run.id ? run : { ...run, id }
  })
  if (runs.length === 0) return null
  const selectedRunId = runs.some((run) => run.id === candidate.selectedRunId)
    ? (candidate.selectedRunId as string)
    : runs[runs.length - 1].id
  return { ...candidate, selectedRunId, runs } as DrivingLineLabDocument
}

export function selectedDrivingLineRun(document: DrivingLineLabDocument) {
  return (
    document.runs.find((run) => run.id === document.selectedRunId) ??
    document.runs[document.runs.length - 1]
  )
}

export function selectDrivingLineRun(
  document: DrivingLineLabDocument,
  runId: string,
) {
  return document.runs.some((run) => run.id === runId)
    ? { ...document, selectedRunId: runId }
    : document
}

export function appendDrivingLineRun(
  document: DrivingLineLabDocument,
  now = new Date().toISOString(),
  runId?: string,
) {
  const createdRun = createDrivingLineRun(document.runs.length + 1, now, runId)
  const claimedRunIds = new Set(document.runs.map((run) => run.id))
  const uniqueRunId = claimUniqueId(createdRun.id, claimedRunIds)
  const run =
    uniqueRunId === createdRun.id
      ? createdRun
      : { ...createdRun, id: uniqueRunId }
  return {
    ...document,
    selectedRunId: run.id,
    runs: [...document.runs, run],
  }
}

export function addDrivingLineContactSlot(
  document: DrivingLineLabDocument,
  contactSlot: DrivingLineContactSlot,
  now = new Date().toISOString(),
) {
  const selectedRunIndex = document.runs.findIndex(
    (run) => run.id === document.selectedRunId,
  )
  if (selectedRunIndex < 0) return document
  const selectedRun = document.runs[selectedRunIndex]
  if (
    selectedRun.contactSlotCount >=
      DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT ||
    !Number.isInteger(contactSlot) ||
    contactSlot < 1 ||
    contactSlot > selectedRun.contactSlotCount
  ) {
    return document
  }
  return {
    ...document,
    runs: document.runs.map((run, runIndex) =>
      runIndex === selectedRunIndex
        ? {
            ...run,
            updatedAt: now,
            contactSlotCount: run.contactSlotCount + 1,
            marks: run.marks.map((mark) =>
              mark.contactSlot > contactSlot
                ? { ...mark, contactSlot: mark.contactSlot + 1 }
                : mark,
            ),
          }
        : run,
    ),
  }
}

export function removeDrivingLineContactSlot(
  document: DrivingLineLabDocument,
  contactSlot: DrivingLineContactSlot,
  now = new Date().toISOString(),
) {
  const selectedRunIndex = document.runs.findIndex(
    (run) => run.id === document.selectedRunId,
  )
  if (selectedRunIndex < 0) return document
  const selectedRun = document.runs[selectedRunIndex]
  if (
    selectedRun.contactSlotCount <=
      DRIVING_LINE_LAB_MINIMUM_CONTACT_SLOT_COUNT ||
    !Number.isInteger(contactSlot) ||
    contactSlot < 1 ||
    contactSlot > selectedRun.contactSlotCount
  ) {
    return document
  }
  return {
    ...document,
    runs: document.runs.map((run, runIndex) => {
      if (runIndex !== selectedRunIndex) return run
      const marks = run.marks
        .filter((mark) => mark.contactSlot !== contactSlot)
        .map((mark) =>
          mark.contactSlot > contactSlot
            ? { ...mark, contactSlot: mark.contactSlot - 1 }
            : mark,
        )
      return {
        ...run,
        updatedAt: now,
        contactSlotCount: run.contactSlotCount - 1,
        marks,
      }
    }),
  }
}

export function addDrivingLineMark(
  document: DrivingLineLabDocument,
  value: NewDrivingLineMark,
  now = new Date().toISOString(),
) {
  if (
    value.contactSlot !== undefined &&
    !validContactSlot(value.contactSlot)
  ) {
    return document
  }
  const candidate = sanitizeMark({
    ...value,
    id: value.id ?? createId('mark'),
    createdAt: value.createdAt ?? now,
  })
  if (!candidate) return document

  const selectedRunIndex = document.runs.findIndex(
    (run) => run.id === document.selectedRunId,
  )
  if (selectedRunIndex < 0) return document
  const selectedRun = document.runs[selectedRunIndex]
  if (
    candidate.contactSlot !== null &&
    candidate.contactSlot > selectedRun.contactSlotCount
  ) {
    return document
  }
  const nearbyMark = selectedRun.marks.find(
    (mark) =>
      cyclicProgressDistance(mark.routeProgress, candidate.routeProgress) <=
      DUPLICATE_MARK_PROGRESS_TOLERANCE,
  )
  const claimedSlots = new Set(
    selectedRun.marks.map((mark) => mark.contactSlot),
  )
  const contactSlot =
    candidate.contactSlot ??
    nearbyMark?.contactSlot ??
    Array.from(
      { length: selectedRun.contactSlotCount },
      (_, index) => (index + 1) as DrivingLineContactSlot,
    ).find((slot) => !claimedSlots.has(slot))
  if (contactSlot === undefined) return document
  const mark: DrivingLineMark = { ...candidate, contactSlot }

  return {
    ...document,
    runs: document.runs.map((run, runIndex) => {
      if (runIndex !== selectedRunIndex) return run
      const duplicateIndex = run.marks.findIndex(
        (candidate) => candidate.contactSlot === mark.contactSlot,
      )
      const marks = [...run.marks]
      if (duplicateIndex >= 0) marks.splice(duplicateIndex, 1)
      marks.push(mark)
      marks.sort((first, second) => first.contactSlot - second.contactSlot)
      return { ...run, updatedAt: now, marks }
    }),
  }
}

export function addDrivingLineMarkWithUndo(
  document: DrivingLineLabDocument,
  value: NewDrivingLineMark,
  now = new Date().toISOString(),
) {
  const previousRun = selectedDrivingLineRun(document)
  const nextDocument = addDrivingLineMark(document, value, now)
  const nextRun = selectedDrivingLineRun(nextDocument)
  return {
    document: nextDocument,
    undo:
      nextRun === previousRun
        ? null
        : ({ runId: previousRun.id, previousRun } satisfies DrivingLineMarkUndo),
  }
}

export function restoreDrivingLineMarkUndo(
  document: DrivingLineLabDocument,
  undo: DrivingLineMarkUndo,
) {
  const runIndex = document.runs.findIndex((run) => run.id === undo.runId)
  if (runIndex < 0) return document
  return {
    ...document,
    runs: document.runs.map((run, index) =>
      index === runIndex ? undo.previousRun : run,
    ),
  }
}

export function undoLastDrivingLineMark(
  document: DrivingLineLabDocument,
  now = new Date().toISOString(),
) {
  const selectedRunIndex = document.runs.findIndex(
    (run) => run.id === document.selectedRunId,
  )
  if (selectedRunIndex < 0) return document
  return {
    ...document,
    runs: document.runs.map((run, runIndex) => {
      if (runIndex !== selectedRunIndex || run.marks.length === 0) return run
      const latestMark = run.marks.reduce((latest, candidate) => {
        const timeDifference =
          Date.parse(candidate.createdAt) - Date.parse(latest.createdAt)
        if (timeDifference !== 0) return timeDifference > 0 ? candidate : latest
        return candidate.id.localeCompare(latest.id) > 0 ? candidate : latest
      })
      return {
        ...run,
        updatedAt: now,
        marks: run.marks.filter((mark) => mark.id !== latestMark.id),
      }
    }),
  }
}

export function drivingLineRunPoints(
  run: DrivingLineRun,
): AuthoredLinePoint[] {
  return run.marks.map(({ routeProgress, offsetMeters }) => ({
    routeProgress,
    offsetMeters,
  }))
}

export function serializeDrivingLineLabDocument(
  document: DrivingLineLabDocument,
) {
  return JSON.stringify(document, null, 2)
}

export function serializeDrivingLineRun(
  document: DrivingLineLabDocument,
  run: DrivingLineRun,
) {
  return JSON.stringify(
    {
      schemaVersion: document.schemaVersion,
      replayKey: document.replayKey,
      routeVersion: document.routeVersion,
      corridorVersion: document.corridorVersion,
      fitterVersion: document.fitterVersion,
      run,
    },
    null,
    2,
  )
}

export function readStoredDrivingLineLab() {
  if (typeof window === 'undefined') return createDrivingLineLabDocument()
  try {
    const raw = window.localStorage.getItem(DRIVING_LINE_LAB_STORAGE_KEY)
    if (!raw) return createDrivingLineLabDocument()
    return (
      sanitizeDrivingLineLabDocument(JSON.parse(raw)) ??
      createDrivingLineLabDocument()
    )
  } catch {
    return createDrivingLineLabDocument()
  }
}

export function storeDrivingLineLab(document: DrivingLineLabDocument) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      DRIVING_LINE_LAB_STORAGE_KEY,
      serializeDrivingLineLabDocument(document),
    )
  } catch {
    // The active pass remains usable in memory when storage is unavailable.
  }
}
