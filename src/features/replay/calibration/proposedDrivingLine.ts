import {
  normalizeAuthoredLinePoints,
  type AuthoredLinePoint,
} from './authoredRacingLine.ts'

export type ProposedDrivingLineMark = AuthoredLinePoint & {
  contactSlot: number
  sourceLapTimeSeconds: number
  minimumOffsetMeters: number
  maximumOffsetMeters: number
  roadFraction: number
  surface: 'white-line' | 'curb' | 'ref-point'
}

export type ProposedDrivingLineAnalysis = {
  markCount: number
  surfaceCounts: Record<ProposedDrivingLineMark['surface'], number>
  sourceTimeRangeSeconds: readonly [number, number]
  routeProgressRange: readonly [number, number]
  offsetRangeMeters: readonly [number, number]
  roadFractionRange: readonly [number, number]
  largestProgressGap: {
    fromContactSlot: number
    toContactSlot: number
    progress: number
  }
  boundsViolationCount: number
  duplicateSlotCount: number
  duplicateProgressCount: number
  contactOrderIsMonotonic: boolean
  routeProgressIsMonotonic: boolean
  sourceTimeIsMonotonic: boolean
  fitRootMeanSquareErrorMeters: number
  fitMaximumErrorMeters: number
  turnEntryMarkCount: number
  fitRootMeanSquareErrorForTurnEntryMeters: number
  fitMaximumErrorForTurnEntryMeters: number
  fitRootMeanSquareErrorBySurfaceMeters: Record<
    ProposedDrivingLineMark['surface'],
    number
  >
  fitMaximumErrorBySurfaceMeters: Record<
    ProposedDrivingLineMark['surface'],
    number
  >
}

const DEFAULT_SAMPLE_COUNT = 512
const MINIMUM_SAMPLE_COUNT = 64
const MAXIMUM_SAMPLE_COUNT = 2048
const DUPLICATE_PROGRESS_TOLERANCE = 1e-8
const MAXIMUM_CONTROL_POINT_COUNT = 96
const MINIMUM_CONTROL_POINT_COUNT = 8
const CONTROL_POINTS_PER_MARK = 1.5
const SMOOTHNESS_PENALTY = 1.6
const FINAL_SMOOTHING_PASSES = 7
const TURN_ENTRY_INFLUENCE_PROGRESS = 0.035
const NUMERICAL_RIDGE = 1e-9
const WHITE_LINE_FIT_WEIGHT = 32
const CURB_FIT_WEIGHT = 80
const TURN_ENTRY_FIT_WEIGHT = 48
const ORDINARY_REFERENCE_FIT_WEIGHT = 4

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function wrap01(value: number) {
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function cyclicProgressDistance(first: number, second: number) {
  const direct = Math.abs(wrap01(first) - wrap01(second))
  return Math.min(direct, 1 - direct)
}

function smoothstep(value: number) {
  const clamped = clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function sortedUniqueMarks(marks: readonly ProposedDrivingLineMark[]) {
  const sorted = [...marks]
    .filter(
      (mark) =>
        Number.isFinite(mark.routeProgress) &&
        Number.isFinite(mark.offsetMeters),
    )
    .map((mark) => ({ ...mark, routeProgress: wrap01(mark.routeProgress) }))
    .sort((first, second) => first.routeProgress - second.routeProgress)
  const unique: ProposedDrivingLineMark[] = []
  for (const mark of sorted) {
    const previous = unique[unique.length - 1]
    if (
      previous &&
      Math.abs(mark.routeProgress - previous.routeProgress) <=
        DUPLICATE_PROGRESS_TOLERANCE
    ) {
      unique[unique.length - 1] = mark
    } else {
      unique.push(mark)
    }
  }
  return unique
}

function turnEntryReferenceSlots(
  sorted: readonly ProposedDrivingLineMark[],
) {
  const slots = new Set<number>()
  for (let index = 0; index < sorted.length; index += 1) {
    const mark = sorted[index]
    if (mark.surface !== 'ref-point') continue
    for (let step = 1; step < sorted.length; step += 1) {
      const next = sorted[(index + step) % sorted.length]
      if (next.surface !== 'curb') continue
      if (
        wrap01(next.routeProgress - mark.routeProgress) <=
        TURN_ENTRY_INFLUENCE_PROGRESS
      ) {
        slots.add(mark.contactSlot)
      }
      break
    }
  }
  return slots
}

function observationWeight(
  mark: ProposedDrivingLineMark,
  turnEntrySlots: ReadonlySet<number>,
) {
  if (mark.surface === 'curb') return CURB_FIT_WEIGHT
  if (mark.surface === 'white-line') return WHITE_LINE_FIT_WEIGHT
  return turnEntrySlots.has(mark.contactSlot)
    ? TURN_ENTRY_FIT_WEIGHT
    : ORDINARY_REFERENCE_FIT_WEIGHT
}

type BasisEntry = readonly [controlPointIndex: number, weight: number]

function periodicCubicBasis(
  routeProgress: number,
  controlPointCount: number,
): readonly BasisEntry[] {
  const tablePosition = wrap01(routeProgress) * controlPointCount
  const tableIndex = Math.floor(tablePosition) % controlPointCount
  const t = tablePosition - Math.floor(tablePosition)
  const t2 = t * t
  const t3 = t2 * t
  return [
    [
      (tableIndex - 1 + controlPointCount) % controlPointCount,
      ((1 - t) * (1 - t) * (1 - t)) / 6,
    ],
    [tableIndex, (3 * t3 - 6 * t2 + 4) / 6],
    [
      (tableIndex + 1) % controlPointCount,
      (-3 * t3 + 3 * t2 + 3 * t + 1) / 6,
    ],
    [(tableIndex + 2) % controlPointCount, t3 / 6],
  ]
}

function solveSymmetricPositiveDefinite(
  matrix: Float64Array,
  rightHandSide: Float64Array,
  size: number,
) {
  const lower = new Float64Array(size * size)
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row * size + column]
      for (let inner = 0; inner < column; inner += 1) {
        value -=
          lower[row * size + inner] * lower[column * size + inner]
      }
      lower[row * size + column] =
        row === column
          ? Math.sqrt(Math.max(value, Number.EPSILON))
          : value / lower[column * size + column]
    }
  }

  const forward = new Float64Array(size)
  for (let row = 0; row < size; row += 1) {
    let value = rightHandSide[row]
    for (let column = 0; column < row; column += 1) {
      value -= lower[row * size + column] * forward[column]
    }
    forward[row] = value / lower[row * size + row]
  }

  const solution = new Float64Array(size)
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = forward[row]
    for (let column = row + 1; column < size; column += 1) {
      value -= lower[column * size + row] * solution[column]
    }
    solution[row] = value / lower[row * size + row]
  }
  return solution
}

function createProductionLineSampler(
  marks: readonly ProposedDrivingLineMark[],
) {
  const sorted = sortedUniqueMarks(marks)
  if (sorted.length === 0) return () => 0
  if (sorted.length === 1) return () => sorted[0].offsetMeters

  const turnEntrySlots = turnEntryReferenceSlots(sorted)
  const controlPointCount = Math.min(
    MAXIMUM_CONTROL_POINT_COUNT,
    Math.max(
      MINIMUM_CONTROL_POINT_COUNT,
      Math.ceil(sorted.length * CONTROL_POINTS_PER_MARK),
    ),
  )
  const matrix = new Float64Array(controlPointCount * controlPointCount)
  const rightHandSide = new Float64Array(controlPointCount)
  for (const mark of sorted) {
    const basis = periodicCubicBasis(mark.routeProgress, controlPointCount)
    const fitWeight = observationWeight(mark, turnEntrySlots)
    for (const [row, rowWeight] of basis) {
      rightHandSide[row] +=
        fitWeight * rowWeight * mark.offsetMeters
      for (const [column, columnWeight] of basis) {
        matrix[row * controlPointCount + column] +=
          fitWeight * rowWeight * columnWeight
      }
    }
  }

  // Penalize changes in lateral acceleration around the closed lap. This is
  // the part that turns isolated observations into one production-usable line.
  // A small local relaxation around visible corner targets lets the car spend
  // curvature where it matters instead of spreading the error into the apex.
  const cornerTargets = sorted.filter(
    (mark) =>
      mark.surface === 'curb' || turnEntrySlots.has(mark.contactSlot),
  )
  for (let index = 0; index < controlPointCount; index += 1) {
    const controlProgress = index / controlPointCount
    const nearestCornerDistance = cornerTargets.reduce(
      (nearest, mark) =>
        Math.min(
          nearest,
          cyclicProgressDistance(controlProgress, mark.routeProgress),
        ),
      Number.POSITIVE_INFINITY,
    )
    const localPenaltyScale =
      0.4 +
      0.6 * smoothstep(nearestCornerDistance / 0.01)
    const secondDifference: readonly BasisEntry[] = [
      [(index - 1 + controlPointCount) % controlPointCount, 1],
      [index, -2],
      [(index + 1) % controlPointCount, 1],
    ]
    for (const [row, rowWeight] of secondDifference) {
      for (const [column, columnWeight] of secondDifference) {
        matrix[row * controlPointCount + column] +=
          SMOOTHNESS_PENALTY *
          localPenaltyScale *
          rowWeight *
          columnWeight
      }
    }
    matrix[index * controlPointCount + index] += NUMERICAL_RIDGE
  }

  const controlPoints = solveSymmetricPositiveDefinite(
    matrix,
    rightHandSide,
    controlPointCount,
  )
  const sampleSpline = (routeProgress: number) => {
    let offsetMeters = 0
    for (const [index, weight] of periodicCubicBasis(
      routeProgress,
      controlPointCount,
    )) {
      offsetMeters += controlPoints[index] * weight
    }
    return offsetMeters
  }
  const minimumObservedOffset = Math.min(
    ...sorted.map((mark) => mark.offsetMeters),
  )
  const maximumObservedOffset = Math.max(
    ...sorted.map((mark) => mark.offsetMeters),
  )
  // Sparse observations can make a high-resolution periodic spline ring in a
  // gap. Keep the proposal inside the lateral envelope the driver actually
  // recorded before applying the final circular smoothing passes.
  let outputTable = Float64Array.from(
    { length: DEFAULT_SAMPLE_COUNT },
    (_, index) =>
      clamp(
        sampleSpline(index / DEFAULT_SAMPLE_COUNT),
        minimumObservedOffset,
        maximumObservedOffset,
      ),
  )
  for (let pass = 0; pass < FINAL_SMOOTHING_PASSES; pass += 1) {
    const smoothed = new Float64Array(outputTable.length)
    for (let index = 0; index < outputTable.length; index += 1) {
      const previous = outputTable[
        (index - 1 + outputTable.length) % outputTable.length
      ]
      const current = outputTable[index]
      const next = outputTable[(index + 1) % outputTable.length]
      smoothed[index] = (previous + 2 * current + next) / 4
    }
    outputTable = smoothed
  }
  return (routeProgress: number) => {
    const tablePosition = wrap01(routeProgress) * outputTable.length
    const index = Math.floor(tablePosition) % outputTable.length
    const nextIndex = (index + 1) % outputTable.length
    const fraction = tablePosition - Math.floor(tablePosition)
    return (
      outputTable[index] +
      (outputTable[nextIndex] - outputTable[index]) * fraction
    )
  }
}

/**
 * Samples the regularized production proposal. Recorded positions are weighted
 * observations: curb contacts and their last turn-entry references are the
 * strongest targets, while ordinary straight references absorb more of the
 * smoothing error so the car reaches the visible corner positions cleanly.
 */
export function sampleProposedDrivingLineAtProgress(
  marks: readonly ProposedDrivingLineMark[],
  routeProgress: number,
) {
  return createProductionLineSampler(marks)(routeProgress)
}

export function createProposedDrivingLine(
  marks: readonly ProposedDrivingLineMark[],
  sampleCount = DEFAULT_SAMPLE_COUNT,
): AuthoredLinePoint[] {
  const sorted = sortedUniqueMarks(marks)
  if (sorted.length < 2) return normalizeAuthoredLinePoints(sorted)
  const count = Math.round(
    clamp(sampleCount, MINIMUM_SAMPLE_COUNT, MAXIMUM_SAMPLE_COUNT),
  )
  const sample = createProductionLineSampler(sorted)
  const samples = Array.from({ length: count }, (_, index) => {
    const routeProgress = index / count
    return {
      routeProgress,
      offsetMeters: sample(routeProgress),
    }
  })
  return normalizeAuthoredLinePoints(samples)
}

export function analyzeProposedDrivingLineMarks(
  marks: readonly ProposedDrivingLineMark[],
): ProposedDrivingLineAnalysis {
  const sorted = sortedUniqueMarks(marks)
  const slots = marks.map((mark) => mark.contactSlot)
  const progresses = marks.map((mark) => mark.routeProgress)
  const sourceTimes = marks.map((mark) => mark.sourceLapTimeSeconds)
  const offsets = marks.map((mark) => mark.offsetMeters)
  const roadFractions = marks.map((mark) => mark.roadFraction)
  const surfaceCounts = {
    'white-line': 0,
    curb: 0,
    'ref-point': 0,
  }
  for (const mark of marks) surfaceCounts[mark.surface] += 1

  let largestProgressGap = {
    fromContactSlot: sorted[0]?.contactSlot ?? 0,
    toContactSlot: sorted[0]?.contactSlot ?? 0,
    progress: 0,
  }
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    const next = sorted[(index + 1) % sorted.length]
    const gap = wrap01(next.routeProgress - current.routeProgress)
    if (gap > largestProgressGap.progress) {
      largestProgressGap = {
        fromContactSlot: current.contactSlot,
        toContactSlot: next.contactSlot,
        progress: gap,
      }
    }
  }

  const range = (values: readonly number[]): readonly [number, number] =>
    values.length > 0
      ? [Math.min(...values), Math.max(...values)]
      : [0, 0]
  const nonIncreasingCount = (values: readonly number[]) =>
    values.reduce(
      (count, value, index) =>
        index > 0 && value <= values[index - 1] ? count + 1 : count,
      0,
    )
  const fittedOffsetAt = createProductionLineSampler(sorted)
  const turnEntrySlots = turnEntryReferenceSlots(sorted)
  const fitErrors = marks.map(
    (mark) => fittedOffsetAt(mark.routeProgress) - mark.offsetMeters,
  )
  const rootMeanSquare = (errors: readonly number[]) =>
    errors.length > 0
      ? Math.sqrt(
          errors.reduce((total, error) => total + error * error, 0) /
            errors.length,
        )
      : 0
  const fitErrorsBySurface = {
    'white-line': [] as number[],
    curb: [] as number[],
    'ref-point': [] as number[],
  }
  marks.forEach((mark, index) => {
    fitErrorsBySurface[mark.surface].push(fitErrors[index])
  })
  const turnEntryErrors = marks.flatMap((mark, index) =>
    turnEntrySlots.has(mark.contactSlot) ? [fitErrors[index]] : [],
  )
  const maximumAbsolute = (errors: readonly number[]) =>
    errors.length > 0
      ? Math.max(...errors.map((error) => Math.abs(error)))
      : 0

  return {
    markCount: marks.length,
    surfaceCounts,
    sourceTimeRangeSeconds: range(sourceTimes),
    routeProgressRange: range(progresses),
    offsetRangeMeters: range(offsets),
    roadFractionRange: range(roadFractions),
    largestProgressGap,
    boundsViolationCount: marks.filter(
      (mark) =>
        mark.offsetMeters < mark.minimumOffsetMeters - 1e-6 ||
        mark.offsetMeters > mark.maximumOffsetMeters + 1e-6,
    ).length,
    duplicateSlotCount: marks.length - new Set(slots).size,
    duplicateProgressCount: marks.length - new Set(progresses).size,
    contactOrderIsMonotonic: nonIncreasingCount(slots) === 0,
    routeProgressIsMonotonic: nonIncreasingCount(progresses) === 0,
    sourceTimeIsMonotonic: nonIncreasingCount(sourceTimes) === 0,
    fitRootMeanSquareErrorMeters: rootMeanSquare(fitErrors),
    fitMaximumErrorMeters: maximumAbsolute(fitErrors),
    turnEntryMarkCount: turnEntryErrors.length,
    fitRootMeanSquareErrorForTurnEntryMeters:
      rootMeanSquare(turnEntryErrors),
    fitMaximumErrorForTurnEntryMeters: maximumAbsolute(turnEntryErrors),
    fitRootMeanSquareErrorBySurfaceMeters: {
      'white-line': rootMeanSquare(fitErrorsBySurface['white-line']),
      curb: rootMeanSquare(fitErrorsBySurface.curb),
      'ref-point': rootMeanSquare(fitErrorsBySurface['ref-point']),
    },
    fitMaximumErrorBySurfaceMeters: {
      'white-line': maximumAbsolute(fitErrorsBySurface['white-line']),
      curb: maximumAbsolute(fitErrorsBySurface.curb),
      'ref-point': maximumAbsolute(fitErrorsBySurface['ref-point']),
    },
  }
}
