import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDrivingLineMark,
  createDrivingLineLabDocument,
  selectedDrivingLineRun,
  serializeDrivingLineRun,
} from '../../../src/features/replay/calibration/drivingLineLab.ts'
import { isDrivingLineRunPayload } from '../../../src/features/replay/calibration/drivingLineRunPayload.ts'

const NOW = '2026-08-28T12:00:00.000Z'

function validPayload() {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-validation')
  const document = addDrivingLineMark(
    initial,
    {
      id: 'mark-validation',
      contactSlot: 1,
      createdAt: NOW,
      routeProgress: 0.25,
      offsetMeters: 2,
      sourceLapTimeSeconds: 18,
      minimumOffsetMeters: -4,
      maximumOffsetMeters: 4,
      roadFraction: 0.75,
      side: 'route-right',
      surface: 'curb',
      toleranceMeters: 0.12,
    },
    NOW,
  )
  return JSON.parse(
    serializeDrivingLineRun(document, selectedDrivingLineRun(document)),
  )
}

test('workspace writer validation accepts the canonical Lab export', () => {
  assert.equal(isDrivingLineRunPayload(validPayload()), true)
  const refPayload = validPayload()
  refPayload.run.marks[0].surface = 'ref-point'
  refPayload.run.marks[0].toleranceMeters = 0.08
  assert.equal(isDrivingLineRunPayload(refPayload), true)
  const expandedPayload = validPayload()
  expandedPayload.run.contactSlotCount = 80
  expandedPayload.run.marks[0].contactSlot = 80
  assert.equal(isDrivingLineRunPayload(expandedPayload), true)
})

test('workspace writer validation rejects incompatible model versions', () => {
  const payload = validPayload()
  assert.equal(
    isDrivingLineRunPayload({ ...payload, corridorVersion: 'wrong-corridor' }),
    false,
  )
  assert.equal(
    isDrivingLineRunPayload({
      ...payload,
      run: { ...payload.run, contactSlotCount: 0 },
    }),
    false,
  )
  assert.equal(
    isDrivingLineRunPayload({
      ...payload,
      run: {
        ...payload.run,
        contactSlotCount: 1,
        marks: [{ ...payload.run.marks[0], contactSlot: 2 }],
      },
    }),
    false,
  )
  assert.equal(
    isDrivingLineRunPayload({ ...payload, fitterVersion: 'wrong-fitter' }),
    false,
  )
})

test('workspace writer validation rejects malformed nested marks', () => {
  const payload = validPayload()
  assert.equal(
    isDrivingLineRunPayload({
      ...payload,
      run: { ...payload.run, marks: [null] },
    }),
    false,
  )
  assert.equal(
    isDrivingLineRunPayload({
      ...payload,
      run: {
        ...payload.run,
        marks: [{ ...payload.run.marks[0], roadFraction: 0.1 }],
      },
    }),
    false,
  )
  assert.equal(
    isDrivingLineRunPayload({
      ...payload,
      run: {
        ...payload.run,
        marks: [{ ...payload.run.marks[0], contactSlot: 29 }],
      },
    }),
    false,
  )
  assert.equal(
    isDrivingLineRunPayload({
      ...payload,
      run: {
        ...payload.run,
        marks: [
          payload.run.marks[0],
          { ...payload.run.marks[0], id: 'duplicate-slot' },
        ],
      },
    }),
    false,
  )
})
