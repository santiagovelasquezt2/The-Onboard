import * as THREE from 'three'
import type { ReplayCarSample, ReplayLocationSample } from '../../replay'
import type { AsphaltProjector } from './carPose'
import { interpolateLocation, openF1ToTrackPlane } from './replayCalibration'
import {
  REPLAY_CURB_DEFAULT_BLEND,
  REPLAY_WHITE_LINE_TIRE_INSET_METERS,
} from './sceneConfig'

const SPEED_TABLE_HZ = 120
const CURVE_ARC_LENGTH_DIVISIONS = 16384
const ANCHOR_SEARCH_DIVISIONS = 4096

export type ReplayMotionSample = {
  position: THREE.Vector3
  heading: THREE.Vector3
  routeProgress: number
}

export type ReplayMotionRoute = {
  curveLengthMeters: number
  recordedDistanceMeters: number
  anchorRouteProgress: number
  sample: (tMs: number) => ReplayMotionSample
  sampleProgress: (routeProgress: number) => ReplayMotionSample
  corridorDiagnostics?: ReplayCorridorDiagnostics
  corridorSample?: (tMs: number) => ReplayCorridorSample
}

export type ReplayCorridorSample = {
  routeProgress: number
  minimumOffsetMeters: number
  maximumOffsetMeters: number
  guideOffsetMeters: number
  offsetMeters: number
  deltaMeters: number
  manualDeltaMeters: number
  roadFraction: number
  curbSide: ReplayCurbSide | null
  curbLabel: string | null
  curbWeight: number
  wheelOnCurb: boolean
}

export type ReplayCorridorDiagnostics = {
  sampleCount: number
  correctedSampleCount: number
  missingCrossSectionCount: number
  missingGuideCount: number
  curbTargetSampleCount: number
  curbGeometryMissingSampleCount: number
  curbWheelMissCount: number
  centerMissCount: number
  footprintCornerMissCount: number
  maximumLateralStepMeters: number
  maximumRouteStepMeters: number
  maximumCorrectionMeters: number
  averageCorrectionMeters: number
  minimumSafeWidthMeters: number
  maximumSafeWidthMeters: number
  curbAlignment: ReplayCurbAlignmentDiagnostic[]
}

export type ReplayCurbAlignmentDiagnostic = {
  label: string
  side: ReplayCurbSide
  nearestCurbDistanceMeters: number | null
  nearestCurbShiftMeters: number | null
  targetSampleCount: number
  geometryMissingSampleCount: number
  wheelMissCount: number
}

export type ReplayTrackCorridorOptions = {
  desiredLateralOffsetMeters: number
  guideSurface?: AsphaltProjector | null
  curbSurface?: AsphaltProjector | null
  marginMeters: number
  searchMeters: number
  maximumRoadWidthMeters: number
  scanStepMeters: number
  sampleSpacingMeters: number
  smoothingPasses: number
  maximumLateralSlope: number
  anchorInfluenceMeters?: number
  curbTransitionMeters?: number
  curbPhaseSearchMeters?: number
  wheelCenterHalfTrackMeters?: number
  wheelCenterHalfWheelbaseMeters?: number
  lateralIntentAnchors?: readonly ReplayLateralIntentAnchor[]
  curbContactWindows?: readonly ReplayCurbContactWindow[]
}

export type ReplayLateralIntentAnchor = {
  routeTimeMs: number
  deltaMeters: number
}

export type ReplayCurbSide = 'left' | 'right'

export type ReplayCurbContactWindow = {
  startRouteTimeMs: number
  endRouteTimeMs: number
  /** Signed side in the GLB/model basis used by the corridor solver. */
  side: ReplayCurbSide
  /** Physical car side seen in the onboard; the local +X basis is mirrored. */
  onboardSide?: ReplayCurbSide
  label: string
  /** 0 = white-line kiss, 1 = full wheel-on-kerb geometry target. */
  blend?: number
  /** Signed nudge along tire-side; positive = toward curb/outward on that side. */
  lateralNudgeMeters?: number
  /** Override REPLAY_WHITE_LINE_TIRE_INSET_METERS for this contact. */
  whiteLineInsetMeters?: number
}

function wrap01(value: number) {
  return ((value % 1) + 1) % 1
}

function wrapTime(tMs: number, durationMs: number) {
  return ((tMs % durationMs) + durationMs) % durationMs
}

function upperCarSampleIndex(samples: ReplayCarSample[], tMs: number) {
  let lower = 1
  let upper = samples.length - 1
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (samples[middle].t_ms < tMs) lower = middle + 1
    else upper = middle
  }
  return lower
}

/** Periodic linear speed sample, including the telemetry gap at the lap seam. */
function speedMetersPerSecondAt(
  samples: ReplayCarSample[],
  tMs: number,
  durationMs: number,
) {
  const sampleTime = wrapTime(tMs, durationMs)
  const first = samples[0]
  const last = samples[samples.length - 1]

  let lower: ReplayCarSample
  let upper: ReplayCarSample
  let lowerTime: number
  let upperTime: number

  if (sampleTime < first.t_ms) {
    lower = last
    upper = first
    lowerTime = last.t_ms - durationMs
    upperTime = first.t_ms
  } else if (sampleTime > last.t_ms) {
    lower = last
    upper = first
    lowerTime = last.t_ms
    upperTime = first.t_ms + durationMs
  } else if (sampleTime <= first.t_ms) {
    lower = first
    upper = samples[1]
    lowerTime = lower.t_ms
    upperTime = upper.t_ms
  } else if (sampleTime >= last.t_ms) {
    lower = samples[samples.length - 2]
    upper = last
    lowerTime = lower.t_ms
    upperTime = upper.t_ms
  } else {
    const upperIndex = upperCarSampleIndex(samples, sampleTime)
    lower = samples[upperIndex - 1]
    upper = samples[upperIndex]
    lowerTime = lower.t_ms
    upperTime = upper.t_ms
  }

  const span = upperTime - lowerTime
  const alpha = span > 0 ? (sampleTime - lowerTime) / span : 0
  const speedKph = lower.speed + (upper.speed - lower.speed) * alpha
  return Math.max(0, Number.isFinite(speedKph) ? speedKph / 3.6 : 0)
}

function closestCurveProgress(
  curve: THREE.CatmullRomCurve3,
  target: THREE.Vector3,
) {
  const candidate = new THREE.Vector3()
  let bestProgress = 0
  let bestDistanceSquared = Number.POSITIVE_INFINITY

  for (let index = 0; index < ANCHOR_SEARCH_DIVISIONS; index += 1) {
    const progress = index / ANCHOR_SEARCH_DIVISIONS
    curve.getPointAt(progress, candidate)
    const distanceSquared = candidate.distanceToSquared(target)
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared
      bestProgress = progress
    }
  }

  // Refine the closest sampled point without changing the underlying route.
  let step = 1 / ANCHOR_SEARCH_DIVISIONS
  for (let iteration = 0; iteration < 12; iteration += 1) {
    for (const direction of [-1, 1]) {
      const progress = wrap01(bestProgress + direction * step)
      curve.getPointAt(progress, candidate)
      const distanceSquared = candidate.distanceToSquared(target)
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestProgress = progress
      }
    }
    step *= 0.5
  }

  return bestProgress
}

/**
 * Build a stable racing line once, then drive distance along it from recorded
 * speed instead of packet-to-packet location timing. The latter contains a few
 * impossible jumps; using it directly makes even a smooth spline surge.
 */
export function createReplayMotionRoute(
  locations: ReplayLocationSample[],
  carData: ReplayCarSample[],
  durationMs: number,
  anchorTimeMs: number,
  headingHalfDistanceMeters = 5,
): ReplayMotionRoute | null {
  if (
    locations.length < 4 ||
    carData.length < 2 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null
  }

  const points: THREE.Vector3[] = []
  for (const location of locations) {
    const plane = openF1ToTrackPlane(location)
    if (!Number.isFinite(plane.x) || !Number.isFinite(plane.z)) continue
    const point = new THREE.Vector3(plane.x, 0, plane.z)
    if (
      points.length === 0 ||
      point.distanceToSquared(points[points.length - 1]) > 1e-4
    ) {
      points.push(point)
    }
  }
  if (points.length < 4) return null

  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal')
  curve.arcLengthDivisions = CURVE_ARC_LENGTH_DIVISIONS
  curve.updateArcLengths()
  const curveLengthMeters = curve.getLength()
  if (!Number.isFinite(curveLengthMeters) || curveLengthMeters <= 0) return null

  const tableSteps = Math.max(
    2,
    Math.ceil((durationMs / 1000) * SPEED_TABLE_HZ),
  )
  const cumulativeDistance = new Float64Array(tableSteps + 1)
  let previousTime = 0
  let previousSpeed = speedMetersPerSecondAt(carData, 0, durationMs)
  for (let index = 1; index <= tableSteps; index += 1) {
    const time = (durationMs * index) / tableSteps
    const speed = speedMetersPerSecondAt(carData, time, durationMs)
    cumulativeDistance[index] =
      cumulativeDistance[index - 1] +
      ((previousSpeed + speed) * 0.5 * (time - previousTime)) / 1000
    previousTime = time
    previousSpeed = speed
  }

  const recordedDistanceMeters = cumulativeDistance[tableSteps]
  if (!Number.isFinite(recordedDistanceMeters) || recordedDistanceMeters <= 0) {
    return null
  }

  const unboundedSpeedProgress = (tMs: number) => {
    const cycle = Math.floor(tMs / durationMs)
    const sampleTime = tMs - cycle * durationMs
    const tablePosition = (sampleTime / durationMs) * tableSteps
    const lowerIndex = Math.min(tableSteps - 1, Math.floor(tablePosition))
    const alpha = tablePosition - lowerIndex
    const distance =
      cumulativeDistance[lowerIndex] +
      (cumulativeDistance[lowerIndex + 1] - cumulativeDistance[lowerIndex]) *
        alpha
    return cycle + distance / recordedDistanceMeters
  }

  const anchorLocation = interpolateLocation(
    locations,
    anchorTimeMs,
    durationMs,
  )
  if (!anchorLocation) return null
  const anchorPlane = openF1ToTrackPlane(anchorLocation)
  const anchorRouteProgress = closestCurveProgress(
    curve,
    new THREE.Vector3(anchorPlane.x, 0, anchorPlane.z),
  )
  const anchorSpeedProgress = unboundedSpeedProgress(anchorTimeMs)
  const headingStep = Math.min(
    0.02,
    Math.max(1e-6, headingHalfDistanceMeters / curveLengthMeters),
  )

  const sampleProgress = (routeProgress: number): ReplayMotionSample => {
    const wrappedProgress = wrap01(routeProgress)
    const position = curve.getPointAt(wrappedProgress)
    const previous = curve.getPointAt(wrap01(wrappedProgress - headingStep))
    const next = curve.getPointAt(wrap01(wrappedProgress + headingStep))
    const heading = next.clone().sub(previous).setY(0).normalize()
    return { position, heading, routeProgress: wrappedProgress }
  }

  return {
    curveLengthMeters,
    recordedDistanceMeters,
    anchorRouteProgress,
    sampleProgress,
    sample(tMs: number) {
      const routeProgress = wrap01(
        anchorRouteProgress + unboundedSpeedProgress(tMs) - anchorSpeedProgress,
      )
      return sampleProgress(routeProgress)
    },
  }
}

type LateralInterval = { minimum: number; maximum: number }

type CachedCorridorGeometry = {
  driveableSurface: AsphaltProjector
  guideSurface: AsphaltProjector | null
  curbSurface: AsphaltProjector | null
  signature: string
  minimumOffsets: Float64Array<ArrayBuffer>
  maximumOffsets: Float64Array<ArrayBuffer>
  guideOffsets: Float64Array<ArrayBuffer>
  leftCurbOffsets: Float64Array<ArrayBuffer>
  rightCurbOffsets: Float64Array<ArrayBuffer>
  leftWheelCurbTargets: Float64Array<ArrayBuffer>
  rightWheelCurbTargets: Float64Array<ArrayBuffer>
  missingCrossSectionCount: number
  missingGuideCount: number
  minimumSafeWidthMeters: number
  maximumSafeWidthMeters: number
}

const CORRIDOR_GEOMETRY_CACHE = new WeakMap<
  ReplayMotionRoute,
  CachedCorridorGeometry
>()

function distanceToInterval(value: number, interval: LateralInterval) {
  if (value < interval.minimum) return interval.minimum - value
  if (value > interval.maximum) return value - interval.maximum
  return 0
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function smoothstep01(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function unwrapProgressNear(progress: number, reference: number) {
  let unwrapped = wrap01(progress)
  while (unwrapped - reference > 0.5) unwrapped -= 1
  while (unwrapped - reference < -0.5) unwrapped += 1
  return unwrapped
}

/**
 * Continuous curb-contact weight: smooth approach/departure outside the window
 * and a trapezoidal plateau inside (inner ramps capped at ~8 m) so the midpoint
 * still reaches full weight without a hard snap at the window boundary.
 */
function curbContactEnvelopeWeight(
  routeProgress: number,
  start: number,
  end: number,
  transitionProgress: number,
  curveLengthMeters: number,
) {
  const spanWrapped = wrap01(end - start)
  const midpoint = wrap01(start + spanWrapped * 0.5)
  const startProgress = unwrapProgressNear(start, midpoint)
  let endProgress = unwrapProgressNear(end, midpoint)
  if (endProgress < startProgress) endProgress += 1
  const sampleProgress = unwrapProgressNear(routeProgress, midpoint)

  const span = Math.max(endProgress - startProgress, 1e-9)
  const innerRampProgress = Math.min(8 / curveLengthMeters, span * 0.5)
  const transition =
    span <= 2 * innerRampProgress
      ? Math.max(transitionProgress, innerRampProgress + 1e-12)
      : transitionProgress
  const outerStart = startProgress - transition
  const outerEnd = endProgress + transition
  if (sampleProgress < outerStart || sampleProgress > outerEnd) return 0

  const approach = smoothstep01((sampleProgress - outerStart) / transition)
  const depart = smoothstep01((outerEnd - sampleProgress) / transition)
  return Math.min(approach, depart)
}

function tableValueAt(table: Float64Array, routeProgress: number) {
  const tablePosition = wrap01(routeProgress) * table.length
  const lower = Math.floor(tablePosition) % table.length
  const upper = (lower + 1) % table.length
  const alpha = tablePosition - Math.floor(tablePosition)
  return table[lower] + (table[upper] - table[lower]) * alpha
}

function optionalTableValueAt(table: Float64Array, routeProgress: number) {
  const tablePosition = wrap01(routeProgress) * table.length
  const lower = Math.floor(tablePosition) % table.length
  const upper = (lower + 1) % table.length
  const lowerValue = table[lower]
  const upperValue = table[upper]
  if (!Number.isFinite(lowerValue)) {
    return Number.isFinite(upperValue) ? upperValue : null
  }
  if (!Number.isFinite(upperValue)) return lowerValue
  const alpha = tablePosition - Math.floor(tablePosition)
  return lowerValue + (upperValue - lowerValue) * alpha
}

const CORRIDOR_BOUNDARY_MIN_ROAD_WIDTH_METERS = 3.5
const CORRIDOR_BOUNDARY_SMOOTHING_PASSES = 8

function smoothBoundaryOffsetTables(
  minimums: Float64Array,
  maximums: Float64Array,
  smoothingPasses: number,
  maximumStepMeters: number,
  minimumRoadWidthMeters: number,
) {
  const sampleCount = minimums.length
  const smoothedMin = new Float64Array(sampleCount)
  const smoothedMax = new Float64Array(sampleCount)

  const enforceMinimumRoadWidth = () => {
    for (let index = 0; index < sampleCount; index += 1) {
      if (maximums[index] < minimums[index] + minimumRoadWidthMeters) {
        maximums[index] = minimums[index] + minimumRoadWidthMeters
      }
    }
  }

  for (let pass = 0; pass < smoothingPasses; pass += 1) {
    for (let index = 0; index < sampleCount; index += 1) {
      const previous = minimums[(index - 1 + sampleCount) % sampleCount]
      const next = minimums[(index + 1) % sampleCount]
      smoothedMin[index] = (previous + minimums[index] * 2 + next) * 0.25
    }
    minimums.set(smoothedMin)

    for (let index = 0; index < sampleCount; index += 1) {
      const previous = maximums[(index - 1 + sampleCount) % sampleCount]
      const next = maximums[(index + 1) % sampleCount]
      smoothedMax[index] = (previous + maximums[index] * 2 + next) * 0.25
    }
    maximums.set(smoothedMax)
    enforceMinimumRoadWidth()
  }

  for (let pass = 0; pass < 32 && maximumStepMeters > 0; pass += 1) {
    for (const table of [minimums, maximums]) {
      for (let index = 0; index < sampleCount; index += 1) {
        const previous = table[(index - 1 + sampleCount) % sampleCount]
        table[index] = clamp(
          table[index],
          previous - maximumStepMeters,
          previous + maximumStepMeters,
        )
      }
      for (let index = sampleCount - 1; index >= 0; index -= 1) {
        const next = table[(index + 1) % sampleCount]
        table[index] = clamp(
          table[index],
          next - maximumStepMeters,
          next + maximumStepMeters,
        )
      }
    }
    enforceMinimumRoadWidth()
  }
}

function constrainOffsetTable(
  values: Float64Array,
  minimums: Float64Array,
  maximums: Float64Array,
  smoothingPasses: number,
  maximumStepMeters: number,
) {
  const sampleCount = values.length
  const smoothed = new Float64Array(sampleCount)
  for (let pass = 0; pass < smoothingPasses; pass += 1) {
    for (let index = 0; index < sampleCount; index += 1) {
      const previous = values[(index - 1 + sampleCount) % sampleCount]
      const next = values[(index + 1) % sampleCount]
      smoothed[index] = clamp(
        (previous + values[index] * 2 + next) * 0.25,
        minimums[index],
        maximums[index],
      )
    }
    values.set(smoothed)
  }

  for (let pass = 0; pass < 32 && maximumStepMeters > 0; pass += 1) {
    for (let index = 0; index < sampleCount; index += 1) {
      const previous = values[(index - 1 + sampleCount) % sampleCount]
      values[index] = clamp(
        clamp(
          values[index],
          previous - maximumStepMeters,
          previous + maximumStepMeters,
        ),
        minimums[index],
        maximums[index],
      )
    }
    for (let index = sampleCount - 1; index >= 0; index -= 1) {
      const next = values[(index + 1) % sampleCount]
      values[index] = clamp(
        clamp(
          values[index],
          next - maximumStepMeters,
          next + maximumStepMeters,
        ),
        minimums[index],
        maximums[index],
      )
    }
  }
}

/**
 * Derive a deterministic, closed road corridor around the measured route.
 *
 * Cross-sections are computed once from the GLB triangles. Runtime samples only
 * interpolate a smooth lateral correction, so there is no nearest-mesh branch
 * switching and no opportunity for the old one-frame teleports to return.
 */
export function createTrackBoundReplayMotionRoute(
  route: ReplayMotionRoute,
  asphalt: AsphaltProjector,
  options: ReplayTrackCorridorOptions,
): ReplayMotionRoute {
  const {
    desiredLateralOffsetMeters,
    guideSurface = null,
    curbSurface = null,
    marginMeters,
    searchMeters,
    maximumRoadWidthMeters,
    scanStepMeters,
    sampleSpacingMeters,
    smoothingPasses,
    maximumLateralSlope,
    anchorInfluenceMeters = 90,
    curbTransitionMeters = 24,
    wheelCenterHalfTrackMeters = 0.82,
    wheelCenterHalfWheelbaseMeters = 1.8,
    lateralIntentAnchors = [],
    curbContactWindows = [],
  } = options
  const sampleCount = Math.max(
    512,
    Math.ceil(route.curveLengthMeters / Math.max(0.5, sampleSpacingMeters)),
  )
  let minimumOffsets = new Float64Array(sampleCount)
  let maximumOffsets = new Float64Array(sampleCount)
  let guideOffsets = new Float64Array(sampleCount)
  let leftCurbOffsets = new Float64Array(sampleCount).fill(Number.NaN)
  let rightCurbOffsets = new Float64Array(sampleCount).fill(Number.NaN)
  let leftWheelCurbTargets = new Float64Array(sampleCount).fill(Number.NaN)
  let rightWheelCurbTargets = new Float64Array(sampleCount).fill(Number.NaN)
  const offsets = new Float64Array(sampleCount)
  const hasCrossSection = new Uint8Array(sampleCount)
  const right = new THREE.Vector3()
  const candidate = new THREE.Vector3()
  let missingCrossSectionCount = 0
  let missingGuideCount = 0
  let minimumSafeWidthMeters = Number.POSITIVE_INFINITY
  let maximumSafeWidthMeters = 0
  const maximumLateralStep =
    Math.max(0, maximumLateralSlope) * (route.curveLengthMeters / sampleCount)
  const geometrySignature = [
    sampleCount,
    desiredLateralOffsetMeters,
    marginMeters,
    searchMeters,
    maximumRoadWidthMeters,
    scanStepMeters,
    smoothingPasses,
    maximumLateralSlope,
    wheelCenterHalfTrackMeters,
    wheelCenterHalfWheelbaseMeters,
    CORRIDOR_BOUNDARY_SMOOTHING_PASSES,
    CORRIDOR_BOUNDARY_MIN_ROAD_WIDTH_METERS,
  ].join(':')
  const cachedGeometry = CORRIDOR_GEOMETRY_CACHE.get(route)
  const hasCachedGeometry = Boolean(
    cachedGeometry &&
    cachedGeometry.driveableSurface === asphalt &&
    cachedGeometry.guideSurface === guideSurface &&
    cachedGeometry.curbSurface === curbSurface &&
    cachedGeometry.signature === geometrySignature,
  )
  if (cachedGeometry && hasCachedGeometry) {
    minimumOffsets = cachedGeometry.minimumOffsets
    maximumOffsets = cachedGeometry.maximumOffsets
    guideOffsets = cachedGeometry.guideOffsets
    leftCurbOffsets = cachedGeometry.leftCurbOffsets
    rightCurbOffsets = cachedGeometry.rightCurbOffsets
    leftWheelCurbTargets = cachedGeometry.leftWheelCurbTargets
    rightWheelCurbTargets = cachedGeometry.rightWheelCurbTargets
    missingCrossSectionCount = cachedGeometry.missingCrossSectionCount
    missingGuideCount = cachedGeometry.missingGuideCount
    minimumSafeWidthMeters = cachedGeometry.minimumSafeWidthMeters
    maximumSafeWidthMeters = cachedGeometry.maximumSafeWidthMeters
  }

  const rawProgressAnchors = lateralIntentAnchors
    .map((anchor) => ({
      routeProgress: route.sample(anchor.routeTimeMs).routeProgress,
      deltaMeters: anchor.deltaMeters,
    }))
    .sort((a, b) => a.routeProgress - b.routeProgress)
  let progressAnchors = rawProgressAnchors
  const influenceProgress = Math.max(
    1 / sampleCount,
    anchorInfluenceMeters / route.curveLengthMeters,
  )
  const deltaAt = (routeProgress: number) => {
    let weightedDelta = 0
    let totalWeight = 0
    for (const anchor of progressAnchors) {
      const directDistance = Math.abs(routeProgress - anchor.routeProgress)
      const distance = Math.min(directDistance, 1 - directDistance)
      if (distance >= influenceProgress) continue
      const phase = distance / influenceProgress
      const weight = 0.5 * (1 + Math.cos(Math.PI * phase))
      weightedDelta += anchor.deltaMeters * weight
      totalWeight += weight
    }
    if (totalWeight <= 1) return weightedDelta
    return weightedDelta / totalWeight
  }

  const rawProgressCurbWindows = curbContactWindows.map((window) => ({
    startProgress: route.sample(window.startRouteTimeMs).routeProgress,
    endProgress: route.sample(window.endRouteTimeMs).routeProgress,
    side: window.side,
    onboardSide: window.onboardSide ?? window.side,
    label: window.label,
    blend: window.blend,
    lateralNudgeMeters: window.lateralNudgeMeters,
    whiteLineInsetMeters: window.whiteLineInsetMeters,
  }))
  let progressCurbWindows = rawProgressCurbWindows
  const curbTransitionProgress = Math.max(
    1 / sampleCount,
    curbTransitionMeters / route.curveLengthMeters,
  )
  const curbIntentAt = (routeProgress: number) => {
    const candidates = progressCurbWindows
      .map((window) => {
        const span = wrap01(window.endProgress - window.startProgress)
        const fromStart = wrap01(routeProgress - window.startProgress)
        const active = span > 1e-9 && fromStart <= span
        const weight = curbContactEnvelopeWeight(
          routeProgress,
          window.startProgress,
          window.endProgress,
          curbTransitionProgress,
          route.curveLengthMeters,
        )
        if (span <= 1e-9 || weight <= 0) {
          return null
        }
        return {
          ...window,
          active,
          weight,
        }
      })
      .filter((candidate) => candidate !== null)
    const activeCandidates = candidates.filter((candidate) => candidate.active)
    const selectedCandidates =
      activeCandidates.length > 0 ? activeCandidates : candidates
    let weightedTarget = 0
    let totalWeight = 0
    let leftWeight = 0
    let rightWeight = 0
    let dominantLabel: string | null = null
    let dominantOnboardSide: ReplayCurbSide | null = null
    let dominantWeight = 0

    let maximumWeight = 0

    for (const window of selectedCandidates) {
      const weight = window.weight
      const tireSide = window.onboardSide ?? window.side
      const tireSideSign = tireSide === 'left' ? -1 : 1
      const curbTargets =
        tireSide === 'left'
          ? leftWheelCurbTargets
          : rightWheelCurbTargets
      const curbWheelOffsetRaw = optionalTableValueAt(curbTargets, routeProgress)
      const curbOffsets =
        tireSide === 'left' ? leftCurbOffsets : rightCurbOffsets
      const curbMidpoint = optionalTableValueAt(curbOffsets, routeProgress)
      const blend = window.blend ?? REPLAY_CURB_DEFAULT_BLEND
      const hasCurbGeometry =
        curbWheelOffsetRaw !== null || curbMidpoint !== null

      const roadEdgeOffset =
        tireSide === 'left'
          ? tableValueAt(minimumOffsets, routeProgress)
          : tableValueAt(maximumOffsets, routeProgress)
      const whiteLineInsetMeters =
        window.whiteLineInsetMeters ?? REPLAY_WHITE_LINE_TIRE_INSET_METERS
      const whiteLineWheelOffset = clamp(
        roadEdgeOffset -
          tireSideSign *
            (wheelCenterHalfTrackMeters - whiteLineInsetMeters),
        tableValueAt(minimumOffsets, routeProgress),
        tableValueAt(maximumOffsets, routeProgress),
      )
      const curbWheelOffset = hasCurbGeometry
        ? clamp(
            curbWheelOffsetRaw ??
              (curbMidpoint as number) -
                tireSideSign * wheelCenterHalfTrackMeters,
            tableValueAt(minimumOffsets, routeProgress),
            tableValueAt(maximumOffsets, routeProgress),
          )
        : whiteLineWheelOffset
      const mixedTarget =
        whiteLineWheelOffset +
        (curbWheelOffset - whiteLineWheelOffset) * blend
      const lateralNudgeMeters = window.lateralNudgeMeters ?? 0
      const target = clamp(
        (blend <= 0.5 || !hasCurbGeometry
          ? whiteLineWheelOffset
          : mixedTarget) +
          tireSideSign * lateralNudgeMeters,
        tableValueAt(minimumOffsets, routeProgress),
        tableValueAt(maximumOffsets, routeProgress),
      )
      weightedTarget += target * weight
      totalWeight += weight
      maximumWeight = Math.max(maximumWeight, weight)
      if (tireSide === 'left') leftWeight += weight
      else rightWeight += weight
      if (weight > dominantWeight) {
        dominantWeight = weight
        dominantLabel = window.label
        dominantOnboardSide = window.onboardSide
      }
    }

    if (totalWeight <= 0) return null
    return {
      targetOffsetMeters: weightedTarget / totalWeight,
      weight: maximumWeight,
      active: activeCandidates.length > 0,
      side: (rightWeight >= leftWeight ? 'right' : 'left') as ReplayCurbSide,
      onboardSide:
        dominantOnboardSide ??
        ((rightWeight >= leftWeight ? 'right' : 'left') as ReplayCurbSide),
      label: dominantLabel,
    }
  }

  if (!hasCachedGeometry) {
    const refineBoundary = (
      surface: AsphaltProjector,
      base: THREE.Vector3,
      direction: THREE.Vector3,
      insideOffset: number,
      outsideOffset: number,
    ) => {
      let inside = insideOffset
      let outside = outsideOffset
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const middle = (inside + outside) * 0.5
        candidate.copy(base).addScaledVector(direction, middle)
        if (surface.contains(candidate.x, candidate.z)) inside = middle
        else outside = middle
      }
      return inside
    }

    const scanIntervals = (
      surface: AsphaltProjector,
      base: THREE.Vector3,
      direction: THREE.Vector3,
    ) => {
      const intervals: LateralInterval[] = []
      let runStart: number | null = null
      let previousOffset = -searchMeters
      let previousInside = false
      const scanSteps = Math.ceil((searchMeters * 2) / scanStepMeters)

      for (let step = 0; step <= scanSteps; step += 1) {
        const offset = -searchMeters + (searchMeters * 2 * step) / scanSteps
        candidate.copy(base).addScaledVector(direction, offset)
        const inside = surface.contains(candidate.x, candidate.z)
        if (inside && !previousInside) {
          runStart =
            step === 0
              ? offset
              : refineBoundary(surface, base, direction, offset, previousOffset)
        } else if (!inside && previousInside && runStart !== null) {
          intervals.push({
            minimum: runStart,
            maximum: refineBoundary(
              surface,
              base,
              direction,
              previousOffset,
              offset,
            ),
          })
          runStart = null
        }
        previousInside = inside
        previousOffset = offset
      }
      if (previousInside && runStart !== null) {
        intervals.push({ minimum: runStart, maximum: searchMeters })
      }
      return intervals
    }
    for (let index = 0; index < sampleCount; index += 1) {
      const base = route.sampleProgress(index / sampleCount)
      right.set(base.heading.z, 0, -base.heading.x).normalize()
      const intervals = scanIntervals(asphalt, base.position, right)
      const grooveIntervals = guideSurface
        ? scanIntervals(guideSurface, base.position, right)
        : []
      const curbIntervals = curbSurface
        ? scanIntervals(curbSurface, base.position, right)
        : []
      const guideCandidates = grooveIntervals
        .map((interval) => (interval.minimum + interval.maximum) * 0.5)
        .filter((guideOffset) =>
          intervals.some(
            (interval) =>
              guideOffset >= interval.minimum &&
              guideOffset <= interval.maximum,
          ),
        )
        .sort(
          (a, b) =>
            Math.abs(a - desiredLateralOffsetMeters) -
            Math.abs(b - desiredLateralOffsetMeters),
        )
      const guideTarget = guideCandidates[0] ?? desiredLateralOffsetMeters
      if (guideCandidates.length === 0) missingGuideCount += 1

      const viable = intervals
        .map((interval) => {
          const rawWidth = interval.maximum - interval.minimum
          if (rawWidth <= maximumRoadWidthMeters) {
            return {
              minimum: interval.minimum + marginMeters,
              maximum: interval.maximum - marginMeters,
            }
          }
          const halfWidth = maximumRoadWidthMeters * 0.5
          const cappedCenter = clamp(
            guideTarget,
            interval.minimum + halfWidth,
            interval.maximum - halfWidth,
          )
          return {
            minimum: cappedCenter - halfWidth + marginMeters,
            maximum: cappedCenter + halfWidth - marginMeters,
          }
        })
        .filter((interval) => interval.maximum >= interval.minimum)
        .sort((a, b) => {
          const distanceDifference =
            distanceToInterval(guideTarget, a) -
            distanceToInterval(guideTarget, b)
          if (Math.abs(distanceDifference) > 1e-9) return distanceDifference
          return b.maximum - b.minimum - (a.maximum - a.minimum)
        })

      const chosen = viable[0]
      if (!chosen) {
        missingCrossSectionCount += 1
        minimumOffsets[index] = desiredLateralOffsetMeters
        maximumOffsets[index] = desiredLateralOffsetMeters
        guideOffsets[index] = desiredLateralOffsetMeters
        continue
      }
      hasCrossSection[index] = 1
      minimumOffsets[index] = chosen.minimum
      maximumOffsets[index] = chosen.maximum
      guideOffsets[index] = clamp(guideTarget, chosen.minimum, chosen.maximum)
      const roadMiddle = (chosen.minimum + chosen.maximum) * 0.5
      const curbCandidates = curbIntervals
        .map((interval) => (interval.minimum + interval.maximum) * 0.5)
        .filter(
          (curbOffset) =>
            curbOffset >= chosen.minimum - marginMeters &&
            curbOffset <= chosen.maximum + marginMeters,
        )
      const leftCandidates = curbCandidates.filter(
        (curbOffset) => curbOffset < roadMiddle,
      )
      const rightCandidates = curbCandidates.filter(
        (curbOffset) => curbOffset >= roadMiddle,
      )
      if (leftCandidates.length > 0) {
        leftCurbOffsets[index] = Math.min(...leftCandidates)
      }
      if (rightCandidates.length > 0) {
        rightCurbOffsets[index] = Math.max(...rightCandidates)
      }
      minimumSafeWidthMeters = Math.min(
        minimumSafeWidthMeters,
        chosen.maximum - chosen.minimum,
      )
      maximumSafeWidthMeters = Math.max(
        maximumSafeWidthMeters,
        chosen.maximum - chosen.minimum,
      )
    }

    // Fill a rare missing cross-section from its nearest valid neighbours before
    // smoothing. This avoids a local snap if a tiny GLB seam misses one scan.
    if (
      missingCrossSectionCount > 0 &&
      missingCrossSectionCount < sampleCount
    ) {
      for (let index = 0; index < sampleCount; index += 1) {
        if (hasCrossSection[index]) continue
        for (let radius = 1; radius < sampleCount; radius += 1) {
          const previous = (index - radius + sampleCount) % sampleCount
          const next = (index + radius) % sampleCount
          const source = hasCrossSection[previous]
            ? previous
            : hasCrossSection[next]
              ? next
              : -1
          if (source < 0) continue
          minimumOffsets[index] = minimumOffsets[source]
          maximumOffsets[index] = maximumOffsets[source]
          guideOffsets[index] = guideOffsets[source]
          leftCurbOffsets[index] = leftCurbOffsets[source]
          rightCurbOffsets[index] = rightCurbOffsets[source]
          break
        }
      }
    }

    smoothBoundaryOffsetTables(
      minimumOffsets,
      maximumOffsets,
      CORRIDOR_BOUNDARY_SMOOTHING_PASSES,
      maximumLateralStep,
      CORRIDOR_BOUNDARY_MIN_ROAD_WIDTH_METERS,
    )

    // Close one- to three-station material seams without inventing curb geometry
    // across a genuinely curb-free part of the circuit.
    for (const curbOffsets of [leftCurbOffsets, rightCurbOffsets]) {
      for (let pass = 0; pass < 3; pass += 1) {
        const filled = curbOffsets.slice()
        for (let index = 0; index < sampleCount; index += 1) {
          if (Number.isFinite(curbOffsets[index])) continue
          const previous = curbOffsets[(index - 1 + sampleCount) % sampleCount]
          const next = curbOffsets[(index + 1) % sampleCount]
          if (!Number.isFinite(previous) || !Number.isFinite(next)) continue
          if (Math.abs(previous - next) > 2) continue
          filled[index] = (previous + next) * 0.5
        }
        curbOffsets.set(filled)
      }
    }

    // Turn the lateral curb strips into actual wheel-placement targets. The
    // front/rear axle point is tested against KerbMat, so curve geometry—not
    // an imaginary wheel at the chassis midpoint—decides the final offset.
    if (curbSurface) {
      const wheelPoint = new THREE.Vector3()
      for (let index = 0; index < sampleCount; index += 1) {
        const base = route.sampleProgress(index / sampleCount)
        right.set(base.heading.z, 0, -base.heading.x).normalize()
        for (const side of ['left', 'right'] as const) {
          const curbOffsets =
            side === 'left' ? leftCurbOffsets : rightCurbOffsets
          const curbMidpoint = curbOffsets[index]
          if (!Number.isFinite(curbMidpoint)) continue
          const sideSign = side === 'left' ? -1 : 1
          const idealOffset = clamp(
            curbMidpoint - sideSign * wheelCenterHalfTrackMeters,
            minimumOffsets[index],
            maximumOffsets[index],
          )
          const minimum = minimumOffsets[index]
          const maximum = maximumOffsets[index]
          const searchSteps = Math.max(1, Math.ceil((maximum - minimum) / 0.05))
          let bestOffset: number | null = null
          let bestDistance = Number.POSITIVE_INFINITY
          for (let step = 0; step <= searchSteps; step += 1) {
            const offset = minimum + ((maximum - minimum) * step) / searchSteps
            let contact = false
            for (const forwardSign of [1, -1]) {
              wheelPoint
                .copy(base.position)
                .addScaledVector(
                  right,
                  offset + sideSign * wheelCenterHalfTrackMeters,
                )
                .addScaledVector(
                  base.heading,
                  forwardSign * wheelCenterHalfWheelbaseMeters,
                )
              if (curbSurface.contains(wheelPoint.x, wheelPoint.z)) {
                contact = true
                break
              }
            }
            if (!contact) continue
            const distance = Math.abs(offset - idealOffset)
            if (distance >= bestDistance) continue
            bestDistance = distance
            bestOffset = offset
          }
          if (bestOffset !== null) {
            const targetTable =
              side === 'left'
                ? leftWheelCurbTargets
                : rightWheelCurbTargets
            targetTable[index] = bestOffset
          }
        }
      }
    }

    for (const curbTargets of [
      leftWheelCurbTargets,
      rightWheelCurbTargets,
    ]) {
      for (let pass = 0; pass < 3; pass += 1) {
        const filled = curbTargets.slice()
        for (let index = 0; index < sampleCount; index += 1) {
          if (Number.isFinite(curbTargets[index])) continue
          const previous = curbTargets[(index - 1 + sampleCount) % sampleCount]
          const next = curbTargets[(index + 1) % sampleCount]
          if (!Number.isFinite(previous) || !Number.isFinite(next)) continue
          if (Math.abs(previous - next) > 2) continue
          filled[index] = (previous + next) * 0.5
        }
        curbTargets.set(filled)
      }

      // A cross-section can briefly switch between front- and rear-wheel
      // solutions. Keep the selected target continuous enough for the chassis
      // to follow without a one-frame lateral snap.
      for (let pass = 0; pass < 8; pass += 1) {
        for (let index = 0; index < sampleCount; index += 1) {
          const previous = (index - 1 + sampleCount) % sampleCount
          if (
            !Number.isFinite(curbTargets[index]) ||
            !Number.isFinite(curbTargets[previous])
          ) {
            continue
          }
          curbTargets[index] = clamp(
            curbTargets[index],
            Math.max(
              minimumOffsets[index],
              curbTargets[previous] - maximumLateralStep,
            ),
            Math.min(
              maximumOffsets[index],
              curbTargets[previous] + maximumLateralStep,
            ),
          )
        }
        for (let index = sampleCount - 1; index >= 0; index -= 1) {
          const next = (index + 1) % sampleCount
          if (
            !Number.isFinite(curbTargets[index]) ||
            !Number.isFinite(curbTargets[next])
          ) {
            continue
          }
          curbTargets[index] = clamp(
            curbTargets[index],
            Math.max(
              minimumOffsets[index],
              curbTargets[next] - maximumLateralStep,
            ),
            Math.min(
              maximumOffsets[index],
              curbTargets[next] + maximumLateralStep,
            ),
          )
        }
      }
    }

    constrainOffsetTable(
      guideOffsets,
      minimumOffsets,
      maximumOffsets,
      smoothingPasses,
      maximumLateralStep,
    )

    CORRIDOR_GEOMETRY_CACHE.set(route, {
      driveableSurface: asphalt,
      guideSurface,
      curbSurface,
      signature: geometrySignature,
      minimumOffsets,
      maximumOffsets,
      guideOffsets,
      leftCurbOffsets,
      rightCurbOffsets,
      leftWheelCurbTargets,
      rightWheelCurbTargets,
      missingCrossSectionCount,
      missingGuideCount,
      minimumSafeWidthMeters,
      maximumSafeWidthMeters,
    })
  }

  // Keep curb windows on the shared video/OpenF1 clock. Longitudinal phase
  // pairing used to warp display progress (car reverse) or desync contacts
  // from the onboard when only windows were shifted. Lateral targeting falls
  // back to the white line when KerbMat is missing at the true timestamp.
  const alignedCurbWindows = rawProgressCurbWindows.map((window) => {
    const rawSpanProgress = wrap01(window.endProgress - window.startProgress)
    const rawMidpointProgress = wrap01(
      window.startProgress + rawSpanProgress * 0.5,
    )
    return {
      ...window,
      rawMidpointProgress,
      phaseDeltaProgress: 0,
      aligned: false,
    }
  })

  // Identity: longitudinal progress follows the recorded route only.
  const displayProgressAt = (rawProgress: number) => wrap01(rawProgress)

  progressCurbWindows = alignedCurbWindows
  progressAnchors = rawProgressAnchors
    .map((anchor) => ({
      ...anchor,
      routeProgress: displayProgressAt(anchor.routeProgress),
    }))
    .sort((a, b) => a.routeProgress - b.routeProgress)

  for (let index = 0; index < sampleCount; index += 1) {
    const routeProgress = index / sampleCount
    const manualDeltaMeters = deltaAt(routeProgress)
    const curbIntent = curbIntentAt(routeProgress)
    const curbMix = curbIntent ? Math.pow(curbIntent.weight, 1.35) : 0
    const automaticOffset = curbIntent
      ? guideOffsets[index] +
        (curbIntent.targetOffsetMeters - guideOffsets[index]) * curbMix
      : guideOffsets[index]
    offsets[index] = clamp(
      automaticOffset + manualDeltaMeters,
      minimumOffsets[index],
      maximumOffsets[index],
    )
  }

  // Footage checkpoints can be very close together at a chicane. Enforce a
  // physical lateral-rate limit in both directions around the closed lap so a
  // contradictory pair of visual anchors can never become a rendered snap.
  constrainOffsetTable(
    offsets,
    minimumOffsets,
    maximumOffsets,
    0,
    maximumLateralStep,
  )

  let correctedSampleCount = 0
  let correctionTotal = 0
  let maximumCorrectionMeters = 0

  const curbAlignment = alignedCurbWindows.map((window) => {
    const shiftMeters = window.phaseDeltaProgress * route.curveLengthMeters
    return {
      label: window.label,
      side: window.side,
      nearestCurbDistanceMeters: window.aligned
        ? Math.abs(shiftMeters)
        : null,
      nearestCurbShiftMeters: window.aligned ? shiftMeters : null,
      targetSampleCount: 0,
      geometryMissingSampleCount: 0,
      wheelMissCount: 0,
    }
  })
  for (let index = 0; index < sampleCount; index += 1) {
    const correction = Math.abs(offsets[index] - guideOffsets[index])
    if (correction > 1e-3) correctedSampleCount += 1
    correctionTotal += correction
    maximumCorrectionMeters = Math.max(maximumCorrectionMeters, correction)
  }

  const lateralOffsetAt = (routeProgress: number) => {
    const tablePosition = wrap01(routeProgress) * sampleCount
    const lower = Math.floor(tablePosition) % sampleCount
    const upper = (lower + 1) % sampleCount
    const alpha = tablePosition - Math.floor(tablePosition)
    return offsets[lower] + (offsets[upper] - offsets[lower]) * alpha
  }
  const correctedPositionAt = (routeProgress: number) => {
    const base = route.sampleProgress(routeProgress)
    right.set(base.heading.z, 0, -base.heading.x).normalize()
    return base.position
      .clone()
      .addScaledVector(right, lateralOffsetAt(routeProgress))
  }
  const headingStep = Math.min(
    0.02,
    Math.max(1e-6, 5 / route.curveLengthMeters),
  )
  const sampleProgress = (routeProgress: number): ReplayMotionSample => {
    const wrappedProgress = wrap01(routeProgress)
    const position = correctedPositionAt(wrappedProgress)
    const previous = correctedPositionAt(wrap01(wrappedProgress - headingStep))
    const next = correctedPositionAt(wrap01(wrappedProgress + headingStep))
    const heading = next.clone().sub(previous).setY(0).normalize()
    return { position, heading, routeProgress: wrappedProgress }
  }
  let centerMissCount = 0
  let footprintCornerMissCount = 0
  let curbTargetSampleCount = 0
  let curbGeometryMissingSampleCount = 0
  let curbWheelMissCount = 0
  let maximumLateralStepMeters = 0
  let maximumRouteStepMeters = 0
  const footprintRight = new THREE.Vector3()
  const footprintPoint = new THREE.Vector3()
  const wheelOnCurb = (
    sample: ReplayMotionSample,
    side: ReplayCurbSide,
  ) => {
    if (!curbSurface) return false
    footprintRight.set(sample.heading.z, 0, -sample.heading.x).normalize()
    const sideSign = side === 'left' ? -1 : 1
    for (const forwardSign of [-1, 1]) {
      footprintPoint
        .copy(sample.position)
        .addScaledVector(
          sample.heading,
          forwardSign * wheelCenterHalfWheelbaseMeters,
        )
        .addScaledVector(
          footprintRight,
          sideSign * wheelCenterHalfTrackMeters,
        )
      if (curbSurface.contains(footprintPoint.x, footprintPoint.z)) return true
    }
    return false
  }
  let previousValidatedPosition: THREE.Vector3 | null = null
  for (let index = 0; index < sampleCount; index += 1) {
    const previousOffset = offsets[(index - 1 + sampleCount) % sampleCount]
    maximumLateralStepMeters = Math.max(
      maximumLateralStepMeters,
      Math.abs(offsets[index] - previousOffset),
    )
  }
  const validationSampleCount = sampleCount * 4
  for (let index = 0; index < validationSampleCount; index += 1) {
    const sample = sampleProgress(index / validationSampleCount)
    if (previousValidatedPosition) {
      maximumRouteStepMeters = Math.max(
        maximumRouteStepMeters,
        sample.position.distanceTo(previousValidatedPosition),
      )
    }
    previousValidatedPosition = sample.position
    if (!asphalt.contains(sample.position.x, sample.position.z)) {
      centerMissCount += 1
    }
    footprintRight.set(sample.heading.z, 0, -sample.heading.x).normalize()
    for (const forwardSign of [-1, 1]) {
      for (const rightSign of [-1, 1]) {
        footprintPoint
          .copy(sample.position)
          .addScaledVector(sample.heading, forwardSign * 2.815)
          .addScaledVector(footprintRight, rightSign * 1.005)
        if (!asphalt.contains(footprintPoint.x, footprintPoint.z)) {
          footprintCornerMissCount += 1
        }
      }
    }
    const validationProgress = index / validationSampleCount
    const activeCurbWindow = progressCurbWindows.find((window) => {
      const span = wrap01(window.endProgress - window.startProgress)
      return wrap01(validationProgress - window.startProgress) <= span
    })
    if (activeCurbWindow) {
      curbTargetSampleCount += 1
      const eventDiagnostics = curbAlignment.find(
        (event) => event.label === activeCurbWindow.label,
      )
      if (eventDiagnostics) eventDiagnostics.targetSampleCount += 1
      const curbIntent = curbIntentAt(validationProgress)
      if (!curbIntent) {
        curbGeometryMissingSampleCount += 1
        if (eventDiagnostics) {
          eventDiagnostics.geometryMissingSampleCount += 1
        }
      }
      if (!wheelOnCurb(sample, activeCurbWindow.onboardSide ?? activeCurbWindow.side)) {
        curbWheelMissCount += 1
        if (eventDiagnostics) eventDiagnostics.wheelMissCount += 1
      }
    }
  }
  const diagnostics: ReplayCorridorDiagnostics = {
    sampleCount,
    correctedSampleCount,
    missingCrossSectionCount,
    missingGuideCount,
    curbTargetSampleCount,
    curbGeometryMissingSampleCount,
    curbWheelMissCount,
    centerMissCount,
    footprintCornerMissCount,
    maximumLateralStepMeters,
    maximumRouteStepMeters,
    maximumCorrectionMeters,
    averageCorrectionMeters: correctionTotal / sampleCount,
    minimumSafeWidthMeters: Number.isFinite(minimumSafeWidthMeters)
      ? minimumSafeWidthMeters
      : 0,
    maximumSafeWidthMeters,
    curbAlignment,
  }

  return {
    ...route,
    corridorDiagnostics: diagnostics,
    corridorSample(tMs: number) {
      const routeProgress = displayProgressAt(route.sample(tMs).routeProgress)
      const minimumOffsetMeters = tableValueAt(minimumOffsets, routeProgress)
      const maximumOffsetMeters = tableValueAt(maximumOffsets, routeProgress)
      const guideOffsetMeters = tableValueAt(guideOffsets, routeProgress)
      const offsetMeters = lateralOffsetAt(routeProgress)
      const width = maximumOffsetMeters - minimumOffsetMeters
      const curbIntent = curbIntentAt(routeProgress)
      const correctedSample = sampleProgress(routeProgress)
      return {
        routeProgress,
        minimumOffsetMeters,
        maximumOffsetMeters,
        guideOffsetMeters,
        offsetMeters,
        deltaMeters: offsetMeters - guideOffsetMeters,
        manualDeltaMeters: deltaAt(routeProgress),
        roadFraction:
          width > 1e-9 ? (offsetMeters - minimumOffsetMeters) / width : 0.5,
        curbSide: curbIntent?.onboardSide ?? null,
        curbLabel: curbIntent?.label ?? null,
        curbWeight: curbIntent?.weight ?? 0,
        wheelOnCurb: Boolean(
          curbIntent && wheelOnCurb(correctedSample, curbIntent.side),
        ),
      }
    },
    sampleProgress,
    sample(tMs: number) {
      return sampleProgress(displayProgressAt(route.sample(tMs).routeProgress))
    },
  }
}
