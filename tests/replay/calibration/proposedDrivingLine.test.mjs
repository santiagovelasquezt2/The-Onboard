import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  analyzeProposedDrivingLineMarks,
  createProposedDrivingLine,
  sampleProposedDrivingLineAtProgress,
} from '../../../src/features/replay/calibration/proposedDrivingLine.ts'
import {
  createProposedDrivingLineTwo,
  PROPOSED_DRIVING_LINE_TWO_REFINEMENTS,
  PROPOSED_DRIVING_LINE_TWO_TURN_10_WINDOW,
} from '../../../src/features/replay/calibration/proposedDrivingLineVariant2.ts'

const PASS_URL = new URL(
  '../../../data/calibration-runs/2024-montreal-q-d63-lap22-contact-pass.json',
  import.meta.url,
)

function mark(contactSlot, routeProgress, offsetMeters, surface = 'ref-point') {
  return {
    contactSlot,
    routeProgress,
    offsetMeters,
    sourceLapTimeSeconds: contactSlot,
    minimumOffsetMeters: -12,
    maximumOffsetMeters: 12,
    roadFraction: (offsetMeters + 12) / 24,
    surface,
  }
}

test('the proposed line uses observations without tracing them exactly', () => {
  const marks = [
    mark(1, 0, 0),
    mark(2, 0.25, 4, 'curb'),
    mark(3, 0.5, 2, 'white-line'),
    mark(4, 0.75, -3),
  ]
  const points = createProposedDrivingLine(marks, 256)
  const residuals = marks.map((observation) =>
    Math.abs(
      sampleProposedDrivingLineAtProgress(
        marks,
        observation.routeProgress,
      ) - observation.offsetMeters,
    ),
  )
  assert.ok(residuals.some((residual) => residual > 0.1))
  assert.ok(
    Math.abs(
      sampleProposedDrivingLineAtProgress(marks, 0) -
        sampleProposedDrivingLineAtProgress(marks, 1),
    ) < 1e-9,
  )

  let maximumStep = 0
  let maximumSecondDifference = 0
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]
    maximumStep = Math.max(
      maximumStep,
      Math.abs(next.offsetMeters - current.offsetMeters),
    )
    maximumSecondDifference = Math.max(
      maximumSecondDifference,
      Math.abs(
        next.offsetMeters -
          2 * current.offsetMeters +
          previous.offsetMeters,
      ),
    )
  }
  assert.ok(maximumStep < 0.1)
  assert.ok(maximumSecondDifference < 0.01)
})

test('the bundled pass is complete, ordered, and produces a dense closed proposal', () => {
  const payload = JSON.parse(readFileSync(PASS_URL, 'utf8'))
  const marks = payload.run.marks
  const analysis = analyzeProposedDrivingLineMarks(marks)
  assert.equal(analysis.markCount, 64)
  assert.deepEqual(analysis.surfaceCounts, {
    'white-line': 14,
    curb: 22,
    'ref-point': 28,
  })
  assert.equal(analysis.boundsViolationCount, 0)
  assert.equal(analysis.duplicateSlotCount, 0)
  assert.equal(analysis.duplicateProgressCount, 0)
  assert.equal(analysis.contactOrderIsMonotonic, true)
  assert.equal(analysis.routeProgressIsMonotonic, true)
  assert.equal(analysis.sourceTimeIsMonotonic, true)
  assert.equal(analysis.largestProgressGap.fromContactSlot, 51)
  assert.equal(analysis.largestProgressGap.toContactSlot, 52)
  assert.equal(analysis.turnEntryMarkCount, 10)
  assert.ok(analysis.fitRootMeanSquareErrorMeters < 1.2)
  assert.ok(analysis.fitMaximumErrorMeters < 3.4)
  assert.ok(analysis.fitRootMeanSquareErrorBySurfaceMeters.curb < 0.95)
  assert.ok(analysis.fitMaximumErrorBySurfaceMeters.curb < 2.3)
  assert.ok(analysis.fitRootMeanSquareErrorForTurnEntryMeters < 1.75)
  assert.ok(analysis.fitMaximumErrorForTurnEntryMeters < 2.6)
  assert.ok(
    analysis.fitRootMeanSquareErrorBySurfaceMeters['white-line'] < 1.35,
  )

  const points = createProposedDrivingLine(marks)
  assert.equal(points.length, 512)
  assert.ok(
    points.every(
      (point) =>
        Number.isFinite(point.routeProgress) &&
        Number.isFinite(point.offsetMeters),
    ),
  )
  assert.ok(
    points.every(
      (point) =>
        point.offsetMeters >= analysis.offsetRangeMeters[0] &&
        point.offsetMeters <= analysis.offsetRangeMeters[1],
    ),
  )

  let maximumStep = 0
  let maximumSecondDifference = 0
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]
    maximumStep = Math.max(
      maximumStep,
      Math.abs(next.offsetMeters - current.offsetMeters),
    )
    maximumSecondDifference = Math.max(
      maximumSecondDifference,
      Math.abs(
        next.offsetMeters -
          2 * current.offsetMeters +
          previous.offsetMeters,
      ),
    )
  }
  assert.ok(maximumStep < 1.75)
  assert.ok(maximumSecondDifference < 0.45)
})

test('proposal two is a local refinement and proposal one stays frozen', () => {
  const payload = JSON.parse(readFileSync(PASS_URL, 'utf8'))
  const marks = payload.run.marks
  const proposalOne = createProposedDrivingLine(marks)
  const proposalTwo = createProposedDrivingLineTwo(proposalOne)

  assert.equal(
    createHash('sha256')
      .update(JSON.stringify(proposalOne))
      .digest('hex'),
    '69e814e57805b3a14747ae45b49b10d336ecb0b9ad8e9362caa27560a94b5bfb',
  )
  assert.equal(proposalTwo.length, proposalOne.length * 2)
  assert.ok(
    proposalTwo.every(
      (point) =>
        Number.isFinite(point.routeProgress) &&
        Number.isFinite(point.offsetMeters),
    ),
  )

  const sampleLine = (points, routeProgress) => {
    const tablePosition = routeProgress * points.length
    const index = Math.floor(tablePosition) % points.length
    const nextIndex = (index + 1) % points.length
    const fraction = tablePosition - Math.floor(tablePosition)
    return (
      points[index].offsetMeters +
      (points[nextIndex].offsetMeters - points[index].offsetMeters) * fraction
    )
  }
  const correctionAtSlot = (contactSlot) => {
    const mark = marks.find(
      (candidate) => candidate.contactSlot === contactSlot,
    )
    assert.ok(mark)
    return (
      sampleLine(proposalTwo, mark.routeProgress) -
      sampleLine(proposalOne, mark.routeProgress)
    )
  }
  assert.ok(correctionAtSlot(16) > 0.4) // Turn 5 curb
  assert.ok(correctionAtSlot(20) > 0.15) // Turn 6 approach clearance
  assert.ok(correctionAtSlot(21) > 0.65)
  assert.ok(correctionAtSlot(22) > 0.75)
  assert.ok(correctionAtSlot(23) > 0.7)
  assert.ok(Math.abs(correctionAtSlot(24)) < 0.03) // Preserve Turn 7
  assert.ok(correctionAtSlot(33) < -1.7) // Turn 8 curb
  assert.ok(correctionAtSlot(34) > 0.9) // Turn 9 curb
  assert.ok(correctionAtSlot(35) > 0.55) // Turn 9 exit wall
  assert.ok(correctionAtSlot(36) > 0.55)
  assert.ok(correctionAtSlot(39) < -1.4) // Turn 10 left white line
  assert.ok(correctionAtSlot(40) > 2.25)
  assert.ok(correctionAtSlot(41) > 0.33) // Turn 10 turn-in
  assert.ok(correctionAtSlot(42) > 0.33)
  assert.ok(correctionAtSlot(56) > 0.75) // Turn 14 curb
  assert.ok(Math.abs(correctionAtSlot(55)) < 0.02) // Preserve Turn 13
  assert.ok(Math.abs(correctionAtSlot(57)) < 0.02) // Preserve Turn 14 exit

  const expandedBySmoothing = 5 / proposalTwo.length
  proposalTwo.forEach((point) => {
    const locallyRefined =
      PROPOSED_DRIVING_LINE_TWO_REFINEMENTS.some(
        (refinement) =>
          point.routeProgress >=
            refinement.startRouteProgress - expandedBySmoothing &&
          point.routeProgress <=
            refinement.endRouteProgress + expandedBySmoothing,
      ) ||
      (point.routeProgress >=
        PROPOSED_DRIVING_LINE_TWO_TURN_10_WINDOW.startRouteProgress &&
        point.routeProgress <=
          PROPOSED_DRIVING_LINE_TWO_TURN_10_WINDOW.endRouteProgress)
    if (!locallyRefined) {
      assert.equal(
        point.offsetMeters,
        sampleLine(proposalOne, point.routeProgress),
      )
    }
  })

  let maximumStep = 0
  let maximumSecondDifference = 0
  for (let index = 0; index < proposalTwo.length; index += 1) {
    const previous =
      proposalTwo[(index - 1 + proposalTwo.length) % proposalTwo.length]
    const current = proposalTwo[index]
    const next = proposalTwo[(index + 1) % proposalTwo.length]
    maximumStep = Math.max(
      maximumStep,
      Math.abs(next.offsetMeters - current.offsetMeters),
    )
    maximumSecondDifference = Math.max(
      maximumSecondDifference,
      Math.abs(
        next.offsetMeters -
          2 * current.offsetMeters +
          previous.offsetMeters,
      ),
    )
  }
  assert.ok(maximumStep < 1.8)
  assert.ok(maximumSecondDifference < 0.95)
})
