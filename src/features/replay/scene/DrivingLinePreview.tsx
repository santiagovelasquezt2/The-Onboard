import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import {
  createAuthoredLineSampler,
  type AuthoredLinePoint,
} from '../calibration/authoredRacingLine'
import type { AsphaltProjector } from './carPose'
import type { ReplayMotionRoute } from './replayMotion'

type DrivingLinePreviewProps = {
  route: ReplayMotionRoute
  driveableProjector: AsphaltProjector
  linePoints: readonly AuthoredLinePoint[]
  marks: readonly DrivingLinePreviewPoint[]
}

export type DrivingLinePreviewPoint = AuthoredLinePoint & {
  surface?: 'white-line' | 'curb' | 'ref-point'
}

const PREVIEW_SAMPLE_SPACING_METERS = 1.8
const PREVIEW_MINIMUM_SAMPLE_COUNT = 256
const PREVIEW_MAXIMUM_SAMPLE_COUNT = 4096
const PREVIEW_SURFACE_LIFT_METERS = 0.045

function projectedPreviewPoint(
  routePoint: THREE.Vector3,
  projector: AsphaltProjector,
) {
  if (!projector.contains(routePoint.x, routePoint.z)) return null
  const surface = projector.project(routePoint.x, routePoint.z)
  if (!surface) return null
  return new THREE.Vector3(routePoint.x, surface.point.y, routePoint.z)
    .addScaledVector(surface.up, PREVIEW_SURFACE_LIFT_METERS)
}

export function DrivingLinePreview({
  route,
  driveableProjector,
  linePoints,
  marks,
}: DrivingLinePreviewProps) {
  const geometry = useMemo(() => {
    if (
      (linePoints.length === 0 && marks.length === 0) ||
      !route.sampleProgressAtOffset
    ) {
      return {
        segments: [] as THREE.Vector3[][],
        markerPoints: [] as Array<{
          point: THREE.Vector3
          surface: DrivingLinePreviewPoint['surface']
        }>,
      }
    }

    const sampleCandidate = createAuthoredLineSampler(
      linePoints,
      route.curveLengthMeters,
    )
    const sampleCount = Math.min(
      PREVIEW_MAXIMUM_SAMPLE_COUNT,
      Math.max(
        PREVIEW_MINIMUM_SAMPLE_COUNT,
        Math.ceil(route.curveLengthMeters / PREVIEW_SAMPLE_SPACING_METERS),
      ),
    )
    const segments: THREE.Vector3[][] = []
    let activeSegment: THREE.Vector3[] = []

    for (let index = 0; index <= sampleCount; index += 1) {
      const routeProgress = index / sampleCount
      const candidate = sampleCandidate(routeProgress)
      if (!candidate || candidate.weight <= 0.001) {
        if (activeSegment.length > 1) segments.push(activeSegment)
        activeSegment = []
        continue
      }
      const baseline = route.sampleProgress(routeProgress).position
      const manual = route.sampleProgressAtOffset(
        routeProgress,
        candidate.offsetMeters,
      ).position
      const planar = baseline.clone().lerp(manual, candidate.weight)
      const point = projectedPreviewPoint(planar, driveableProjector)
      if (point) {
        activeSegment.push(point)
      } else if (activeSegment.length > 1) {
        segments.push(activeSegment)
        activeSegment = []
      } else {
        activeSegment = []
      }
    }
    if (activeSegment.length > 1) segments.push(activeSegment)

    const markerPoints = marks.flatMap((mark) => {
      const planar = route.sampleProgressAtOffset?.(
        mark.routeProgress,
        mark.offsetMeters,
      )?.position
      if (!planar) return []
      const point = projectedPreviewPoint(planar, driveableProjector)
      return point ? [{ point, surface: mark.surface }] : []
    })

    return { segments, markerPoints }
  }, [driveableProjector, linePoints, marks, route])

  return (
    <group renderOrder={4}>
      {geometry.segments.map((points, index) => (
        <Line
          key={`${points.length}:${index}`}
          points={points}
          color="#40e870"
          lineWidth={3}
          opacity={0.9}
          transparent
          toneMapped={false}
          depthTest
          depthWrite={false}
        />
      ))}
      {geometry.markerPoints.map((marker, index) => (
        <mesh
          key={`${index}:${marker.point.x}:${marker.point.z}`}
          position={marker.point}
        >
          <sphereGeometry
            args={[
              marker.surface === 'curb'
                ? 0.38
                : marker.surface === 'ref-point'
                  ? 0.28
                  : 0.32,
              16,
              12,
            ]}
          />
          <meshBasicMaterial
            color={
              marker.surface === 'curb'
                ? '#c8ff5c'
                : marker.surface === 'ref-point'
                  ? '#65c7ff'
                  : '#78ff9c'
            }
            toneMapped={false}
            depthTest
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}
