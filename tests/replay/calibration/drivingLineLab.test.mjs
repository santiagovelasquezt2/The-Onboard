import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDrivingLineContactSlot,
  addDrivingLineMark,
  addDrivingLineMarkWithUndo,
  appendDrivingLineRun,
  createDrivingLineLabDocument,
  DRIVING_LINE_LAB_CONTACT_SLOT_COUNT,
  drivingLineRunPoints,
  removeDrivingLineContactSlot,
  sanitizeDrivingLineLabDocument,
  restoreDrivingLineMarkUndo,
  selectedDrivingLineRun,
  serializeDrivingLineRun,
  undoLastDrivingLineMark,
} from '../../../src/features/replay/calibration/drivingLineLab.ts'
import {
  DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS,
  drivingLinePreviewLapTimeFromVehicleLapTime,
  drivingLineSourceVideoTimeFromVehicleLapTime,
  drivingLineVideoLeadForCameraView,
  drivingLineVehicleLapTimeFromPreviewLapTime,
} from '../../../src/features/replay/calibration/drivingLineLabClock.ts'
import {
  clampDrivingLineComparisonOffset,
  DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS,
  drivingLineComparisonVehicleTime,
} from '../../../src/features/replay/calibration/drivingLineComparisonTiming.ts'

const NOW = '2026-08-28T12:00:00.000Z'

function mark(overrides = {}) {
  return {
    id: 'mark-1',
    createdAt: NOW,
    routeProgress: 0.25,
    offsetMeters: 2,
    sourceLapTimeSeconds: 18,
    minimumOffsetMeters: -4,
    maximumOffsetMeters: 4,
    roadFraction: 0.75,
    side: 'route-right',
    surface: 'white-line',
    toleranceMeters: 0.18,
    ...overrides,
  }
}

test('the onboard stays half a second ahead through the finish line', () => {
  assert.equal(DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS, 0.5)
  assert.equal(drivingLinePreviewLapTimeFromVehicleLapTime(0, 72), 0.5)
  assert.equal(drivingLineVehicleLapTimeFromPreviewLapTime(0.5, 72), 0)
  assert.equal(drivingLinePreviewLapTimeFromVehicleLapTime(72, 72), 72.5)
  assert.equal(drivingLineVehicleLapTimeFromPreviewLapTime(72.5, 72), 72)
})

test('aerial positioning leads while the base onboard clock stays synchronized', () => {
  const lapWindow = { videoStartSeconds: 5.2, lapDurationSeconds: 72 }
  const aerialLead = drivingLineVideoLeadForCameraView('overhead')
  const comparisonLead = drivingLineVideoLeadForCameraView('onboard')

  assert.equal(aerialLead, 0.5)
  assert.equal(comparisonLead, 0)
  for (const vehicleTime of [0, 14.4, 28.2, 36, 57.6, 72]) {
    const aerialSourceTime = drivingLineSourceVideoTimeFromVehicleLapTime(
      vehicleTime,
      lapWindow,
      aerialLead,
    )
    const comparisonSourceTime = drivingLineSourceVideoTimeFromVehicleLapTime(
      vehicleTime,
      lapWindow,
      comparisonLead,
    )
    assert.ok(
      Math.abs(aerialSourceTime - (5.2 + vehicleTime + 0.5)) < 1e-9,
    )
    assert.ok(
      Math.abs(comparisonSourceTime - (5.2 + vehicleTime)) < 1e-9,
    )
    assert.ok(
      Math.abs(
        drivingLineVehicleLapTimeFromPreviewLapTime(
          aerialSourceTime - lapWindow.videoStartSeconds,
          lapWindow.lapDurationSeconds,
          aerialLead,
        ) - vehicleTime,
      ) < 1e-9,
    )
    assert.ok(
      Math.abs(
        drivingLineVehicleLapTimeFromPreviewLapTime(
          comparisonSourceTime - lapWindow.videoStartSeconds,
          lapWindow.lapDurationSeconds,
          comparisonLead,
        ) - vehicleTime,
      ) < 1e-9,
    )
  }
})

test('3D comparison timing starts a tenth ahead and remains adjustable', () => {
  assert.equal(DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS, 0.1)
  assert.equal(drivingLineComparisonVehicleTime(20, 72, 0.1), 20.1)
  assert.equal(drivingLineComparisonVehicleTime(20, 72, -0.15), 19.85)
  assert.equal(drivingLineComparisonVehicleTime(71.95, 72, 0.1), 72)
  assert.equal(drivingLineComparisonVehicleTime(0.05, 72, -0.1), 0)
  assert.equal(clampDrivingLineComparisonOffset(2), 0.5)
  assert.equal(clampDrivingLineComparisonOffset(-2), -0.5)
})

test('a new pass preserves every point in the previous pass', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const marked = addDrivingLineMark(initial, mark(), NOW)
  const next = appendDrivingLineRun(
    marked,
    '2026-08-28T12:10:00.000Z',
    'contact-pass-2',
  )

  assert.equal(next.runs.length, 2)
  assert.equal(next.runs[0].marks.length, 1)
  assert.equal(next.runs[0].marks[0].offsetMeters, 2)
  assert.equal(selectedDrivingLineRun(next).id, 'contact-pass-2')
  assert.equal(selectedDrivingLineRun(next).marks.length, 0)
})

test('duplicate seam marks replace instead of creating key-repeat noise', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const first = addDrivingLineMark(
    initial,
    mark({ routeProgress: 0.999995 }),
    NOW,
  )
  const replaced = addDrivingLineMark(
    first,
    mark({
      id: 'mark-2',
      routeProgress: 0.000005,
      offsetMeters: -1,
      side: 'route-left',
    }),
    '2026-08-28T12:00:01.000Z',
  )

  const run = selectedDrivingLineRun(replaced)
  assert.equal(run.marks.length, 1)
  assert.equal(run.marks[0].contactSlot, 1)
  assert.equal(run.marks[0].id, 'mark-2')
  assert.equal(run.marks[0].offsetMeters, -1)
})

test('undo removes only the latest point in the selected pass', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const first = addDrivingLineMark(initial, mark(), NOW)
  const second = addDrivingLineMark(
    first,
    mark({ id: 'mark-2', routeProgress: 0.5 }),
    NOW,
  )
  const undone = undoLastDrivingLineMark(second, NOW)

  assert.deepEqual(
    selectedDrivingLineRun(undone).marks.map((point) => point.id),
    ['mark-1'],
  )
})

test('fallback undo removes the latest action, not the highest numbered slot', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const highSlot = addDrivingLineMark(
    initial,
    mark({ id: 'slot-28', contactSlot: 28, createdAt: NOW }),
    NOW,
  )
  const laterLowSlot = addDrivingLineMark(
    highSlot,
    mark({
      id: 'slot-1-later',
      contactSlot: 1,
      createdAt: '2026-08-28T12:00:01.000Z',
      routeProgress: 0.5,
    }),
    '2026-08-28T12:00:01.000Z',
  )

  const undone = undoLastDrivingLineMark(laterLowSlot, NOW)
  assert.deepEqual(
    selectedDrivingLineRun(undone).marks.map((point) => point.id),
    ['slot-28'],
  )
})

test('action undo restores the prior value when the same slot is updated', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const first = addDrivingLineMark(initial, mark(), NOW)
  const second = addDrivingLineMark(
    first,
    mark({ id: 'mark-2', routeProgress: 0.5 }),
    NOW,
  )
  const slotted = addDrivingLineMark(
    second,
    mark({ id: 'mark-slot-7', contactSlot: 7, routeProgress: 0.65 }),
    NOW,
  )
  const replacement = addDrivingLineMarkWithUndo(
    slotted,
    mark({
      id: 'mark-3',
      contactSlot: 7,
      routeProgress: 0.8,
      offsetMeters: -1,
      side: 'route-left',
    }),
    '2026-08-28T12:00:01.000Z',
  )
  assert.ok(replacement.undo)
  assert.equal(selectedDrivingLineRun(replacement.document).marks.length, 3)
  assert.equal(
    selectedDrivingLineRun(replacement.document).marks.find(
      (point) => point.contactSlot === 7,
    ).id,
    'mark-3',
  )

  const restored = restoreDrivingLineMarkUndo(
    replacement.document,
    replacement.undo,
  )
  assert.deepEqual(
    selectedDrivingLineRun(restored).marks.map((point) => point.id),
    ['mark-1', 'mark-2', 'mark-slot-7'],
  )
  assert.equal(
    selectedDrivingLineRun(restored).marks.find(
      (point) => point.contactSlot === 7,
    ).routeProgress,
    0.65,
  )
})

test('legacy slotless marks migrate deterministically without data loss', () => {
  const document = createDrivingLineLabDocument(NOW, 'contact-pass-legacy')
  const late = mark({
    id: 'late-contact',
    routeProgress: 0.7,
    sourceLapTimeSeconds: 50,
  })
  const early = mark({
    id: 'early-contact',
    routeProgress: 0.1,
    sourceLapTimeSeconds: 8,
  })
  const middle = mark({
    id: 'middle-contact',
    contactSlot: 2,
    routeProgress: 0.4,
    sourceLapTimeSeconds: 30,
  })
  const legacyValue = {
    ...document,
    runs: [
      {
        ...document.runs[0],
        contactSlotCount: undefined,
        marks: [late, middle, early],
      },
    ],
  }
  const reversedValue = {
    ...document,
    runs: [{ ...document.runs[0], marks: [early, middle, late] }],
  }

  const migrated = sanitizeDrivingLineLabDocument(legacyValue)
  const migratedReversed = sanitizeDrivingLineLabDocument(reversedValue)
  assert.ok(migrated)
  assert.ok(migratedReversed)
  assert.equal(migrated.schemaVersion, 1)
  assert.equal(
    selectedDrivingLineRun(migrated).contactSlotCount,
    DRIVING_LINE_LAB_CONTACT_SLOT_COUNT,
  )
  assert.equal(selectedDrivingLineRun(migrated).marks.length, 3)
  assert.deepEqual(
    selectedDrivingLineRun(migrated).marks.map(({ id, contactSlot }) => ({
      id,
      contactSlot,
    })),
    [
      { id: 'early-contact', contactSlot: 1 },
      { id: 'middle-contact', contactSlot: 2 },
      { id: 'late-contact', contactSlot: 3 },
    ],
  )
  assert.deepEqual(
    selectedDrivingLineRun(migratedReversed).marks,
    selectedDrivingLineRun(migrated).marks,
  )
})

test('a run starts with twenty-eight contact slots and can add another', () => {
  let document = createDrivingLineLabDocument(NOW, 'contact-pass-slots')
  for (
    let contactSlot = 1;
    contactSlot <= DRIVING_LINE_LAB_CONTACT_SLOT_COUNT;
    contactSlot += 1
  ) {
    document = addDrivingLineMark(
      document,
      mark({
        id: `mark-${contactSlot}`,
        contactSlot,
        routeProgress:
          contactSlot / (DRIVING_LINE_LAB_CONTACT_SLOT_COUNT + 1),
        sourceLapTimeSeconds: contactSlot,
      }),
      NOW,
    )
  }
  const fullRun = selectedDrivingLineRun(document)
  assert.equal(fullRun.marks.length, DRIVING_LINE_LAB_CONTACT_SLOT_COUNT)
  assert.equal(fullRun.contactSlotCount, DRIVING_LINE_LAB_CONTACT_SLOT_COUNT)
  assert.deepEqual(
    fullRun.marks.map((point) => point.contactSlot),
    Array.from(
      { length: DRIVING_LINE_LAB_CONTACT_SLOT_COUNT },
      (_, index) => index + 1,
    ),
  )

  const expanded = addDrivingLineContactSlot(
    document,
    DRIVING_LINE_LAB_CONTACT_SLOT_COUNT,
    NOW,
  )
  assert.equal(
    selectedDrivingLineRun(expanded).contactSlotCount,
    DRIVING_LINE_LAB_CONTACT_SLOT_COUNT + 1,
  )
  const overflowMark = addDrivingLineMark(
    expanded,
    mark({
      id: 'mark-29',
      contactSlot: 29,
      routeProgress: 0.999,
    }),
    NOW,
  )
  assert.equal(selectedDrivingLineRun(overflowMark).marks.length, 29)
})

test('adding a contact box inserts after the selected box and renumbers later marks', () => {
  let document = createDrivingLineLabDocument(NOW, 'contact-pass-insert')
  document = addDrivingLineMark(
    document,
    mark({ id: 'slot-5', contactSlot: 5, routeProgress: 0.3 }),
    NOW,
  )
  document = addDrivingLineMark(
    document,
    mark({ id: 'slot-6', contactSlot: 6, routeProgress: 0.4 }),
    NOW,
  )

  const inserted = addDrivingLineContactSlot(document, 5, NOW)
  const run = selectedDrivingLineRun(inserted)
  assert.equal(run.contactSlotCount, 29)
  assert.deepEqual(
    run.marks.map(({ id, contactSlot }) => ({ id, contactSlot })),
    [
      { id: 'slot-5', contactSlot: 5 },
      { id: 'slot-6', contactSlot: 7 },
    ],
  )
})

test('removing a contact box deletes its mark and renumbers later boxes', () => {
  let document = createDrivingLineLabDocument(NOW, 'contact-pass-remove')
  document = addDrivingLineMark(
    document,
    mark({ id: 'slot-4', contactSlot: 4, routeProgress: 0.2 }),
    NOW,
  )
  document = addDrivingLineMark(
    document,
    mark({ id: 'slot-5', contactSlot: 5, routeProgress: 0.3 }),
    NOW,
  )

  const removed = removeDrivingLineContactSlot(document, 4, NOW)
  const run = selectedDrivingLineRun(removed)
  assert.equal(run.contactSlotCount, 27)
  assert.deepEqual(
    run.marks.map(({ id, contactSlot }) => ({ id, contactSlot })),
    [{ id: 'slot-5', contactSlot: 4 }],
  )
})

test('ref points persist as a distinct contact type', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-ref')
  const document = addDrivingLineMark(
    initial,
    mark({ surface: 'ref-point', toleranceMeters: 0.08 }),
    NOW,
  )
  const sanitized = sanitizeDrivingLineLabDocument(
    JSON.parse(JSON.stringify(document)),
  )
  assert.ok(sanitized)
  assert.equal(selectedDrivingLineRun(sanitized).marks[0].surface, 'ref-point')
})

test('stored duplicate pass ids are repaired without merging their marks', () => {
  const document = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const duplicateRun = {
    ...document.runs[0],
    name: 'Second pass',
    marks: [mark({ id: 'mark-2', routeProgress: 0.5 })],
  }
  const sanitized = sanitizeDrivingLineLabDocument({
    ...document,
    runs: [document.runs[0], duplicateRun],
  })

  assert.ok(sanitized)
  assert.deepEqual(
    sanitized.runs.map((run) => run.id),
    ['contact-pass-1', 'contact-pass-1-2'],
  )
  assert.equal(sanitized.runs[0].marks.length, 0)
  assert.equal(sanitized.runs[1].marks[0].id, 'mark-2')
})

test('stored documents reject another replay or route version', () => {
  const document = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  assert.equal(
    sanitizeDrivingLineLabDocument({ ...document, replayKey: 'wrong' }),
    null,
  )
  assert.equal(
    sanitizeDrivingLineLabDocument({ ...document, routeVersion: 'wrong' }),
    null,
  )
})

test('export contains raw marks and canonical route-relative preview points', () => {
  const initial = createDrivingLineLabDocument(NOW, 'contact-pass-1')
  const document = addDrivingLineMark(initial, mark(), NOW)
  const run = selectedDrivingLineRun(document)
  const payload = JSON.parse(serializeDrivingLineRun(document, run))

  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.replayKey, '9527:63:22')
  assert.equal(payload.routeVersion, 'montreal-2019-openf1-route-v1')
  assert.equal(payload.run.marks.length, 1)
  assert.equal(payload.run.marks[0].contactSlot, 1)
  assert.deepEqual(drivingLineRunPoints(run), [
    { routeProgress: 0.25, offsetMeters: 2 },
  ])
})
