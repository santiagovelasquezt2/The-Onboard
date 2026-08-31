// This module stays dependency-free because it is shared by the browser and
// Vite's Node-only development writer.
const REPLAY_KEY = '9527:63:22'
const ROUTE_VERSION = 'montreal-2019-openf1-route-v1'
const CORRIDOR_VERSION = 'montreal-corridor-v1'
const FITTER_VERSION = 'local-influence-v1'
const MAXIMUM_CONTACT_SLOT_COUNT = 128

type DrivingLineMark = {
  id: string
  contactSlot: number
  routeProgress: number
  offsetMeters: number
  sourceLapTimeSeconds: number
  minimumOffsetMeters: number
  maximumOffsetMeters: number
  roadFraction: number
  side: 'route-left' | 'route-right'
  surface: 'white-line' | 'curb' | 'ref-point'
  toleranceMeters: number
  createdAt: string
}

type DrivingLineRun = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  contactSlotCount: number
  marks: DrivingLineMark[]
}

export type DrivingLineRunPayload = {
  schemaVersion: 1
  replayKey: typeof REPLAY_KEY
  routeVersion: typeof ROUTE_VERSION
  corridorVersion: typeof CORRIDOR_VERSION
  fitterVersion: typeof FITTER_VERSION
  run: DrivingLineRun
}

const SAFE_RUN_ID = /^[a-zA-Z0-9_-]+$/

function finiteInRange(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function validIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validMark(value: unknown): value is DrivingLineMark {
  if (!value || typeof value !== 'object') return false
  const mark = value as Partial<DrivingLineMark>
  if (
    typeof mark.id !== 'string' ||
    mark.id.length === 0 ||
    mark.id.length > 200 ||
    !Number.isInteger(mark.contactSlot) ||
    !finiteInRange(mark.contactSlot, 1, MAXIMUM_CONTACT_SLOT_COUNT) ||
    !finiteInRange(mark.routeProgress, 0, 1) ||
    !finiteInRange(mark.offsetMeters, -24, 24) ||
    !finiteInRange(mark.sourceLapTimeSeconds, 0, 24 * 60 * 60) ||
    !finiteInRange(mark.minimumOffsetMeters, -24, 24) ||
    !finiteInRange(mark.maximumOffsetMeters, -24, 24) ||
    !finiteInRange(mark.roadFraction, 0, 1) ||
    !finiteInRange(mark.toleranceMeters, 0.01, 5) ||
    !validIsoDate(mark.createdAt) ||
    (mark.surface !== 'white-line' &&
      mark.surface !== 'curb' &&
      mark.surface !== 'ref-point') ||
    (mark.side !== 'route-left' && mark.side !== 'route-right')
  ) {
    return false
  }

  const minimum = mark.minimumOffsetMeters as number
  const maximum = mark.maximumOffsetMeters as number
  const offset = mark.offsetMeters as number
  if (minimum > maximum || offset < minimum || offset > maximum) return false

  const width = maximum - minimum
  const expectedFraction =
    width > 1e-9 ? (offset - minimum) / width : (mark.roadFraction as number)
  const expectedSide = expectedFraction < 0.5 ? 'route-left' : 'route-right'
  return (
    Math.abs((mark.roadFraction as number) - expectedFraction) <= 1e-6 &&
    mark.side === expectedSide
  )
}

function validRun(value: unknown): value is DrivingLineRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<DrivingLineRun>
  if (
    !(
      typeof run.id === 'string' &&
      SAFE_RUN_ID.test(run.id) &&
      typeof run.name === 'string' &&
      run.name.length > 0 &&
      run.name.length <= 80 &&
      run.name === run.name.trim() &&
      validIsoDate(run.createdAt) &&
      validIsoDate(run.updatedAt) &&
      Number.isInteger(run.contactSlotCount) &&
      finiteInRange(run.contactSlotCount, 1, MAXIMUM_CONTACT_SLOT_COUNT) &&
      Array.isArray(run.marks) &&
      run.marks.every(validMark) &&
      run.marks.every(
        (mark) => mark.contactSlot <= (run.contactSlotCount as number),
      )
    )
  ) {
    return false
  }

  const contactSlots = run.marks.map((mark) => mark.contactSlot)
  return new Set(contactSlots).size === contactSlots.length
}

export function isDrivingLineRunPayload(
  value: unknown,
): value is DrivingLineRunPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<DrivingLineRunPayload>
  return (
    payload.schemaVersion === 1 &&
    payload.replayKey === REPLAY_KEY &&
    payload.routeVersion === ROUTE_VERSION &&
    payload.corridorVersion === CORRIDOR_VERSION &&
    payload.fitterVersion === FITTER_VERSION &&
    validRun(payload.run)
  )
}
