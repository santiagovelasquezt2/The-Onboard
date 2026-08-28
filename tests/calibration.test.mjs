import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeAuthoredLineTake,
  normalizeAuthoredLinePoints,
  removeNearestAuthoredLinePoint,
  sampleAuthoredLineAtProgress,
} from '../src/authoredRacingLine.ts'
import {
  normalizeReplaySyncAnchors,
  removeNearestReplaySyncAnchor,
  replaySyncOffsetAtLapTime,
  upsertReplaySyncAnchor,
} from '../src/replaySyncCalibration.ts'
import {
  flattenSectionLineTakes,
  inheritedSectionEntry,
  replaceSectionLineTake,
} from '../src/sectionRacingLine.ts'
import {
  viewerDeltaToRouteDelta,
  viewerDirectionToRouteDirection,
  viewerRoadFraction,
} from '../src/calibrationControls.ts'
import {
  expandManualCalibrationBounds,
  twoWheelOutsideWhiteLineAllowance,
} from '../src/calibrationCorridor.ts'
import {
  CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX,
  CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN,
  CALIBRATION_CAMERA_MAX_HEIGHT_METERS,
  CALIBRATION_CAMERA_MIN_HEIGHT_METERS,
  calibrationCameraDistanceControlFromHeight,
  calibrationCameraHeightFromDistanceControl,
  clampCalibrationCameraHeight,
} from '../src/calibrationCamera.ts'
import {
  CALIBRATION_RECORDING_VIDEO_LEAD_SECONDS,
  calibrationVideoLeadForRecording,
  previewVideoLapTimeFromVehicleLapTime,
  vehicleLapTimeFromPreviewVideoLapTime,
} from '../src/calibrationVideoLead.ts'
import {
  CALIBRATION_SECTIONS,
  calibrationSectionProgress,
} from '../src/calibrationSections.ts'
import {
  REPLAY_CALIBRATION_WHITE_LINE_ALLOWANCE_METERS,
  REPLAY_WHEEL_CENTER_HALF_TRACK_METERS,
  REPLAY_WHITE_LINE_TIRE_INSET_METERS,
  OVERHEAD_CAMERA_HEIGHT,
} from '../src/components/scene/sceneConfig.ts'

test('viewer left/right controls map to the mirrored route coordinate', () => {
  assert.equal(viewerDirectionToRouteDirection(-1), 1)
  assert.equal(viewerDirectionToRouteDirection(1), -1)
  assert.equal(viewerDirectionToRouteDirection(0), 0)
  assert.equal(viewerDeltaToRouteDelta(-0.25), 0.25)
  assert.equal(viewerDeltaToRouteDelta(0.25), -0.25)
  assert.equal(viewerRoadFraction(0), 1)
  assert.equal(viewerRoadFraction(1), 0)
})

test('manual calibration supports a legal two-wheel white-line exit', () => {
  assert.deepEqual(expandManualCalibrationBounds(-3, 4, 1.5, 0.65), {
    minimumOffsetMeters: -3.65,
    maximumOffsetMeters: 4.65,
  })
  assert.deepEqual(expandManualCalibrationBounds(-3, 4, 1.5, 10), {
    minimumOffsetMeters: -4.5,
    maximumOffsetMeters: 5.5,
  })
  assert.deepEqual(expandManualCalibrationBounds(-3, 4, 1.5, -1), {
    minimumOffsetMeters: -3,
    maximumOffsetMeters: 4,
  })

  const outsideAllowance = twoWheelOutsideWhiteLineAllowance(
    REPLAY_CALIBRATION_WHITE_LINE_ALLOWANCE_METERS,
    REPLAY_WHEEL_CENTER_HALF_TRACK_METERS,
    REPLAY_WHITE_LINE_TIRE_INSET_METERS,
  )
  assert.ok(
    Math.abs(
      outsideAllowance -
        (REPLAY_WHEEL_CENTER_HALF_TRACK_METERS -
          REPLAY_WHITE_LINE_TIRE_INSET_METERS),
    ) < 1e-9,
  )
  assert.ok(
    outsideAllowance + REPLAY_WHITE_LINE_TIRE_INSET_METERS <=
      REPLAY_WHEEL_CENTER_HALF_TRACK_METERS,
  )
  assert.ok(outsideAllowance > 0)
})

test('calibration camera distance stays within practical overhead limits', () => {
  assert.equal(
    clampCalibrationCameraHeight(-10),
    CALIBRATION_CAMERA_MIN_HEIGHT_METERS,
  )
  assert.equal(
    clampCalibrationCameraHeight(999),
    CALIBRATION_CAMERA_MAX_HEIGHT_METERS,
  )
  assert.equal(
    clampCalibrationCameraHeight(CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS),
    CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  )
  assert.equal(
    OVERHEAD_CAMERA_HEIGHT,
    CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  )
})

test('aerial camera distance control has perceptual closer and farther ends', () => {
  assert.equal(
    calibrationCameraHeightFromDistanceControl(
      CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN,
    ),
    CALIBRATION_CAMERA_MIN_HEIGHT_METERS,
  )
  assert.equal(
    calibrationCameraHeightFromDistanceControl(
      CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX,
    ),
    CALIBRATION_CAMERA_MAX_HEIGHT_METERS,
  )
  const midpoint =
    (CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN +
      CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX) /
    2
  assert.ok(
    Math.abs(
      calibrationCameraHeightFromDistanceControl(midpoint) -
        Math.sqrt(
          CALIBRATION_CAMERA_MIN_HEIGHT_METERS *
            CALIBRATION_CAMERA_MAX_HEIGHT_METERS,
        ),
    ) < 1e-9,
  )
  const defaultControl = calibrationCameraDistanceControlFromHeight(
    CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  )
  assert.ok(
    Math.abs(
      calibrationCameraHeightFromDistanceControl(defaultControl) -
        CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
    ) < 1e-9,
  )
})

test('recording preview leads the car by half a second', () => {
  const lapWindow = {
    videoStartSeconds: 5.2,
    lapDurationSeconds: 72,
  }
  const leadSeconds = calibrationVideoLeadForRecording(true, 68, lapWindow)

  assert.equal(leadSeconds, CALIBRATION_RECORDING_VIDEO_LEAD_SECONDS)
  assert.equal(leadSeconds, 0.5)
  assert.equal(
    previewVideoLapTimeFromVehicleLapTime(29, leadSeconds, lapWindow),
    29.5,
  )
  assert.equal(
    vehicleLapTimeFromPreviewVideoLapTime(29.5, leadSeconds, lapWindow),
    29,
  )
})

test('section progress resets and clamps to the selected section', () => {
  const section = CALIBRATION_SECTIONS[1]

  assert.equal(calibrationSectionProgress(9, section), 0)
  assert.equal(calibrationSectionProgress(10, section), 0)
  assert.equal(calibrationSectionProgress(14.5, section), 0.5)
  assert.equal(calibrationSectionProgress(19, section), 1)
  assert.equal(calibrationSectionProgress(20, section), 1)
})

test('the final calibration section remains synchronous at the end of footage', () => {
  const lapWindow = {
    videoStartSeconds: 5.2,
    lapDurationSeconds: 72,
  }

  assert.equal(calibrationVideoLeadForRecording(true, 72, lapWindow), 0)
  assert.equal(calibrationVideoLeadForRecording(false, 68, lapWindow), 0)
})

test('authored line interpolates continuously across the lap seam', () => {
  const sample = sampleAuthoredLineAtProgress(
    [
      { routeProgress: 0.99, offsetMeters: -1 },
      { routeProgress: 0.01, offsetMeters: 1 },
    ],
    0,
    100,
    5,
    2,
  )

  assert.ok(sample)
  assert.equal(sample.weight, 1)
  assert.ok(Math.abs(sample.offsetMeters) < 1e-9)
})

test('an unrecorded route gap falls back to the automatic line', () => {
  const points = [
    { routeProgress: 0.2, offsetMeters: 2 },
    { routeProgress: 0.21, offsetMeters: 4 },
  ]

  assert.equal(sampleAuthoredLineAtProgress(points, 0.5, 1000), null)
  assert.ok(
    Math.abs(
      sampleAuthoredLineAtProgress(points, 0.205, 1000).offsetMeters - 3,
    ) < 1e-9,
  )
})

test('overlapping segment-edge blends do not jump at their midpoint', () => {
  const points = [
    { routeProgress: 0.1, offsetMeters: -2 },
    { routeProgress: 0.12, offsetMeters: 2 },
  ]
  const before = sampleAuthoredLineAtProgress(points, 0.109999, 1000)
  const after = sampleAuthoredLineAtProgress(points, 0.110001, 1000)

  assert.ok(before && after)
  assert.ok(Math.abs(before.offsetMeters - after.offsetMeters) < 0.01)
})

test('a punch-in replaces only the route interval it covered', () => {
  const merged = mergeAuthoredLineTake(
    [
      { routeProgress: 0.1, offsetMeters: 1 },
      { routeProgress: 0.2, offsetMeters: 2 },
      { routeProgress: 0.3, offsetMeters: 3 },
      { routeProgress: 0.4, offsetMeters: 4 },
    ],
    [
      { routeProgress: 0.18, offsetMeters: -1 },
      { routeProgress: 0.25, offsetMeters: -2 },
    ],
  )

  assert.deepEqual(
    merged.map((point) => point.routeProgress),
    [0.1, 0.18, 0.25, 0.3, 0.4],
  )
})

test('a punch-in can cross the closed-route seam', () => {
  const merged = mergeAuthoredLineTake(
    [
      { routeProgress: 0.01, offsetMeters: 1 },
      { routeProgress: 0.5, offsetMeters: 2 },
      { routeProgress: 0.97, offsetMeters: 3 },
    ],
    [
      { routeProgress: 0.95, offsetMeters: -1 },
      { routeProgress: 0.02, offsetMeters: -2 },
    ],
  )

  assert.deepEqual(
    merged.map((point) => point.routeProgress),
    [0.02, 0.5, 0.95],
  )
})

test('a ninety-percent punch-in preserves the untouched remainder', () => {
  const take = [
    { routeProgress: 0, offsetMeters: -1 },
    { routeProgress: 0.9, offsetMeters: 1 },
  ]
  const merged = mergeAuthoredLineTake(
    [{ routeProgress: 0.95, offsetMeters: 3 }],
    take,
  )

  assert.ok(merged.some((point) => point.routeProgress === 0.95))
})

test('authored points are sorted, wrapped, clamped, and deduplicated', () => {
  const points = normalizeAuthoredLinePoints([
    { routeProgress: 1.2, offsetMeters: 30 },
    { routeProgress: 0.2, offsetMeters: 2 },
    { routeProgress: -0.1, offsetMeters: -30 },
  ])

  assert.deepEqual(points, [
    { routeProgress: 0.2, offsetMeters: 2 },
    { routeProgress: 0.9, offsetMeters: -24 },
  ])
})

test('fine-edit removal deletes the nearest authored point', () => {
  const points = removeNearestAuthoredLinePoint(
    [
      { routeProgress: 0.1, offsetMeters: 1 },
      { routeProgress: 0.2, offsetMeters: 2 },
    ],
    0.2001,
    0.001,
  )

  assert.deepEqual(points, [{ routeProgress: 0.1, offsetMeters: 1 }])
})

test('sync checkpoints preserve forward-only route time', () => {
  const duration = 72
  const anchors = normalizeReplaySyncAnchors(
    [
      { lapTimeSeconds: 10, offsetSeconds: 2 },
      { lapTimeSeconds: 10.1, offsetSeconds: -2 },
      { lapTimeSeconds: 50, offsetSeconds: 1.5 },
    ],
    duration,
  )
  let previousMappedTime = 0
  for (let index = 1; index <= duration * 20; index += 1) {
    const lapTime = index / 20
    const mappedTime =
      lapTime + replaySyncOffsetAtLapTime(anchors, lapTime, duration)
    assert.ok(mappedTime > previousMappedTime)
    previousMappedTime = mappedTime
  }
  assert.equal(replaySyncOffsetAtLapTime(anchors, 0, duration), 0)
  assert.equal(replaySyncOffsetAtLapTime(anchors, duration, duration), 0)
})

test('sync nudge inserts a bounded checkpoint away from the seam', () => {
  const anchors = upsertReplaySyncAnchor([], 20, 0.05, 72)
  assert.deepEqual(anchors, [
    { lapTimeSeconds: 20, offsetSeconds: 0.05 },
  ])
})

test('sync checkpoint removal deletes the nearby checkpoint', () => {
  const anchors = removeNearestReplaySyncAnchor(
    [
      { lapTimeSeconds: 20, offsetSeconds: 0.05 },
      { lapTimeSeconds: 40, offsetSeconds: -0.05 },
    ],
    20.1,
    72,
  )

  assert.deepEqual(anchors, [
    { lapTimeSeconds: 40, offsetSeconds: -0.05 },
  ])
})

test('a section recording inherits the immediately previous section exit', () => {
  const takes = replaceSectionLineTake(
    [
      {
        sectionId: 'opening-chicane',
        points: [
          { routeProgress: 0.01, offsetMeters: -1 },
          { routeProgress: 0.12, offsetMeters: 2 },
        ],
      },
    ],
    'turns-3-to-5',
    [
      { routeProgress: 0.121, offsetMeters: -6 },
      { routeProgress: 0.25, offsetMeters: -3 },
    ],
  )

  assert.deepEqual(
    inheritedSectionEntry(takes, 'turns-3-to-5'),
    { routeProgress: 0.12, offsetMeters: 2 },
  )
  assert.deepEqual(takes[1].points[0], {
    routeProgress: 0.121,
    offsetMeters: 2,
  })
})

test('a manual entry edit updates both sides of the shared seam', () => {
  const takes = replaceSectionLineTake(
    [
      {
        sectionId: 'opening-chicane',
        points: [
          { routeProgress: 0.01, offsetMeters: -1 },
          { routeProgress: 0.12, offsetMeters: 2 },
        ],
      },
      {
        sectionId: 'turns-6-to-7',
        points: [
          { routeProgress: 0.36, offsetMeters: 9 },
          { routeProgress: 0.46, offsetMeters: 4 },
        ],
      },
    ],
    'turns-3-to-5',
    [
      { routeProgress: 0.121, offsetMeters: -6 },
      { routeProgress: 0.25, offsetMeters: -3 },
    ],
    { mode: 'manual', offsetMeters: 5 },
  )

  assert.equal(takes[0].points.at(-1).offsetMeters, 5)
  assert.equal(takes[1].points[0].offsetMeters, 5)
  assert.equal(takes[2].points[0].offsetMeters, -3)
})

test('section takes flatten back into the existing authored-line contract', () => {
  const points = flattenSectionLineTakes([
    {
      sectionId: 'opening-chicane',
      points: [
        { routeProgress: 0.1, offsetMeters: 1 },
        { routeProgress: 0.2, offsetMeters: 2 },
      ],
    },
    {
      sectionId: 'turns-3-to-5',
      points: [
        { routeProgress: 0.2, offsetMeters: 2 },
        { routeProgress: 0.3, offsetMeters: 3 },
      ],
    },
  ])

  assert.deepEqual(points, [
    { routeProgress: 0.1, offsetMeters: 1 },
    { routeProgress: 0.2, offsetMeters: 2 },
    { routeProgress: 0.3, offsetMeters: 3 },
  ])
})
