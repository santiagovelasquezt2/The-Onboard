import type { AuthoredLinePoint } from './authoredRacingLine.ts'

export type ProposedDrivingLineRefinement = {
  id: string
  label: string
  startRouteProgress: number
  fullStartRouteProgress: number
  fullEndRouteProgress: number
  endRouteProgress: number
  /** Signed route-coordinate adjustment applied on top of proposed onboard 1. */
  deltaMeters: number
}

const CORRECTION_SMOOTHING_PASSES = 4
const PROPOSAL_TWO_SAMPLE_MULTIPLIER = 2

export const PROPOSED_DRIVING_LINE_TWO_TURN_10_WINDOW = {
  startRouteProgress: 0.532278,
  whiteLineStartRouteProgress: 0.564314,
  whiteLineEndRouteProgress: 0.598983,
  whiteLineReleaseRouteProgress: 0.6005,
  turnInStartRouteProgress: 0.606602,
  turnInEndRouteProgress: 0.612275,
  endRouteProgress: 0.621414,
  whiteLineStartOffsetMeters: 1.066020413536106,
  whiteLineEndOffsetMeters: 4.136423544169684,
  turnInCorrectionMeters: 0.35,
} as const

/**
 * Review-two corrections derived from the second visual pass. Each adjustment
 * has compact support and a zero-slope edge, so unaffected straights and the
 * already-good T13/T14 exit stay effectively unchanged from proposal one.
 */
export const PROPOSED_DRIVING_LINE_TWO_REFINEMENTS: readonly ProposedDrivingLineRefinement[] = [
  {
    id: 'turn-5-curb',
    label: 'Turn 5 curb placement',
    startRouteProgress: 0.190907,
    fullStartRouteProgress: 0.200316,
    fullEndRouteProgress: 0.200316,
    endRouteProgress: 0.208605,
    deltaMeters: 0.45,
  },
  {
    id: 'turn-6-wall-clearance',
    label: 'Turn 6 approach and apex wall clearance',
    startRouteProgress: 0.2555,
    fullStartRouteProgress: 0.267,
    fullEndRouteProgress: 0.282309,
    endRouteProgress: 0.28732,
    deltaMeters: 0.8,
  },
  {
    id: 'turn-8-curb',
    label: 'Turn 8 curb placement',
    startRouteProgress: 0.440675,
    fullStartRouteProgress: 0.44958,
    fullEndRouteProgress: 0.44958,
    endRouteProgress: 0.455268,
    deltaMeters: -1.9,
  },
  {
    id: 'turn-9-curb',
    label: 'Turn 9 curb placement',
    startRouteProgress: 0.455268,
    fullStartRouteProgress: 0.458383,
    fullEndRouteProgress: 0.458383,
    endRouteProgress: 0.468529,
    deltaMeters: 1.2,
  },
  {
    id: 'turn-9-exit-clearance',
    label: 'Turn 9 exit wall clearance',
    startRouteProgress: 0.465993,
    fullStartRouteProgress: 0.472465,
    fullEndRouteProgress: 0.483834,
    endRouteProgress: 0.493956,
    deltaMeters: 0.6,
  },
  {
    id: 'turn-14-curb',
    label: 'Turn 14 curb placement',
    startRouteProgress: 0.887638,
    fullStartRouteProgress: 0.891048,
    fullEndRouteProgress: 0.891048,
    endRouteProgress: 0.898725,
    deltaMeters: 1,
  },
]

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function smoothstep01(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function refinementWeight(
  routeProgress: number,
  refinement: ProposedDrivingLineRefinement,
) {
  if (
    routeProgress <= refinement.startRouteProgress ||
    routeProgress >= refinement.endRouteProgress
  ) {
    return 0
  }
  if (routeProgress < refinement.fullStartRouteProgress) {
    return smoothstep01(
      (routeProgress - refinement.startRouteProgress) /
        (refinement.fullStartRouteProgress - refinement.startRouteProgress),
    )
  }
  if (routeProgress <= refinement.fullEndRouteProgress) return 1
  return smoothstep01(
    1 -
      (routeProgress - refinement.fullEndRouteProgress) /
        (refinement.endRouteProgress - refinement.fullEndRouteProgress),
  )
}

export function proposedDrivingLineTwoCorrectionAtProgress(
  routeProgress: number,
) {
  return PROPOSED_DRIVING_LINE_TWO_REFINEMENTS.reduce(
    (correction, refinement) =>
      correction +
      refinement.deltaMeters * refinementWeight(routeProgress, refinement),
    0,
  )
}

function lerp(first: number, second: number, alpha: number) {
  return first + (second - first) * alpha
}

function createPeriodicLineSampler(points: readonly AuthoredLinePoint[]) {
  return (routeProgress: number) => {
    const wrapped = ((routeProgress % 1) + 1) % 1
    const tablePosition = wrapped * points.length
    const index = Math.floor(tablePosition) % points.length
    const nextIndex = (index + 1) % points.length
    const fraction = tablePosition - Math.floor(tablePosition)
    return lerp(
      points[index].offsetMeters,
      points[nextIndex].offsetMeters,
      fraction,
    )
  }
}

function turnTenEntryCorrectionAtProgress(
  routeProgress: number,
  sampleProposalOne: (routeProgress: number) => number,
) {
  const window = PROPOSED_DRIVING_LINE_TWO_TURN_10_WINDOW
  if (
    routeProgress <= window.startRouteProgress ||
    routeProgress >= window.endRouteProgress
  ) {
    return 0
  }
  if (routeProgress < window.whiteLineStartRouteProgress) {
    const correctionAtWhiteLineStart =
      window.whiteLineStartOffsetMeters -
      sampleProposalOne(window.whiteLineStartRouteProgress)
    return (
      correctionAtWhiteLineStart *
      smoothstep01(
        (routeProgress - window.startRouteProgress) /
          (window.whiteLineStartRouteProgress - window.startRouteProgress),
      )
    )
  }
  if (routeProgress <= window.whiteLineEndRouteProgress) {
    const alpha =
      (routeProgress - window.whiteLineStartRouteProgress) /
      (window.whiteLineEndRouteProgress -
        window.whiteLineStartRouteProgress)
    const whiteLineTarget = lerp(
      window.whiteLineStartOffsetMeters,
      window.whiteLineEndOffsetMeters,
      alpha,
    )
    return whiteLineTarget - sampleProposalOne(routeProgress)
  }
  if (routeProgress <= window.whiteLineReleaseRouteProgress) {
    return (
      window.whiteLineEndOffsetMeters -
      sampleProposalOne(routeProgress)
    )
  }
  const correctionAtWhiteLineRelease =
    window.whiteLineEndOffsetMeters -
    sampleProposalOne(window.whiteLineReleaseRouteProgress)
  if (routeProgress < window.turnInStartRouteProgress) {
    return lerp(
      correctionAtWhiteLineRelease,
      window.turnInCorrectionMeters,
      smoothstep01(
        (routeProgress - window.whiteLineReleaseRouteProgress) /
          (window.turnInStartRouteProgress -
            window.whiteLineReleaseRouteProgress),
      ),
    )
  }
  if (routeProgress <= window.turnInEndRouteProgress) {
    return window.turnInCorrectionMeters
  }
  return (
    window.turnInCorrectionMeters *
    smoothstep01(
      1 -
        (routeProgress - window.turnInEndRouteProgress) /
          (window.endRouteProgress - window.turnInEndRouteProgress),
    )
  )
}

export function createProposedDrivingLineTwo(
  proposedDrivingLineOne: readonly AuthoredLinePoint[],
): AuthoredLinePoint[] {
  const sampleProposalOne = createPeriodicLineSampler(proposedDrivingLineOne)
  const proposalTwoSampleCount =
    proposedDrivingLineOne.length * PROPOSAL_TWO_SAMPLE_MULTIPLIER
  const proposalTwoBase = Array.from(
    { length: proposalTwoSampleCount },
    (_, index) => {
      const routeProgress = index / proposalTwoSampleCount
      return {
        routeProgress,
        offsetMeters: sampleProposalOne(routeProgress),
      }
    },
  )
  let corrections = Float64Array.from(
    proposalTwoBase,
    (point) =>
      proposedDrivingLineTwoCorrectionAtProgress(point.routeProgress),
  )
  for (let pass = 0; pass < CORRECTION_SMOOTHING_PASSES; pass += 1) {
    const smoothed = new Float64Array(corrections.length)
    for (let index = 0; index < corrections.length; index += 1) {
      const previous =
        corrections[
          (index - 1 + corrections.length) % corrections.length
        ]
      const current = corrections[index]
      const next = corrections[(index + 1) % corrections.length]
      smoothed[index] = (previous + 2 * current + next) / 4
    }
    corrections = smoothed
  }
  return proposalTwoBase.map((point, index) => ({
    routeProgress: point.routeProgress,
    offsetMeters:
      point.offsetMeters +
      corrections[index] +
      turnTenEntryCorrectionAtProgress(
        point.routeProgress,
        sampleProposalOne,
      ),
  }))
}
