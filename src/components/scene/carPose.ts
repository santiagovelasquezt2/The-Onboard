import * as THREE from 'three'
import type { ReplayLocationSample } from '../../replay'
import {
  ASPHALT_MATERIAL_PATTERN,
  CAR_FORWARD_NUDGE,
  CAR_GROUND_EPSILON,
  CAR_LATERAL_NUDGE,
  CAR_SPAWN_XZ,
  CAR_YAW_OFFSET,
  REPLAY_HEADING_WINDOW_MS,
  REPLAY_ROAD_MATERIAL_PATTERN,
  REPLAY_SPLINE_MAX_DEVIATION,
  REPLAY_SURFACE_BANKING,
} from './sceneConfig'
import {
  interpolateHeading,
  interpolateLocation,
  interpolateSmoothedLocation,
  openF1ToTrackPlane,
} from './replayCalibration'
import type { ReplayMotionRoute, ReplayMotionSample } from './replayMotion'

export type CarPose = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  source:
    | 'asphalt-triangle'
    | 'spawn-override'
    | 'raycast'
    | 'replay-location'
    | 'origin'
  surfaceMaterial: string | null
  surfaceArea: number
}

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const DOWN_RAYCASTER = new THREE.Raycaster()
const BOUNDS_CACHE = new WeakMap<THREE.Object3D, THREE.Box3>()
const ASPHALT_GRID_CELL_METERS = 24
const ASPHALT_PROJECTION_RADIUS_METERS = 48

type AsphaltTriangleSurface = {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  upA: THREE.Vector3
  upB: THREE.Vector3
  upC: THREE.Vector3
  materialName: string | null
  area: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type AsphaltProjection = {
  point: THREE.Vector3
  up: THREE.Vector3
  surfaceMaterial: string | null
  surfaceArea: number
  distance: number
}

export type AsphaltProjector = {
  project: (x: number, z: number) => AsphaltProjection | null
  contains: (x: number, z: number) => boolean
}

function worldBounds(root: THREE.Object3D) {
  const cached = BOUNDS_CACHE.get(root)
  if (cached) return cached
  const bounds = new THREE.Box3().setFromObject(root)
  BOUNDS_CACHE.set(root, bounds)
  return bounds
}

function materialNames(mesh: THREE.Mesh): string[] {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material]
  return materials.filter(Boolean).map((material) => material.name ?? '')
}

export function collectSurfaceMeshes(
  root: THREE.Object3D,
  materialPattern: RegExp,
): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (materialNames(object).some((name) => materialPattern.test(name))) {
      found.push(object)
    }
  })
  return found
}

export function collectAsphaltMeshes(root: THREE.Object3D): THREE.Mesh[] {
  return collectSurfaceMeshes(root, ASPHALT_MATERIAL_PATTERN)
}

type ClosestTrianglePoint = {
  distanceSquared: number
  weightA: number
  weightB: number
  weightC: number
  x: number
  z: number
}

/** Closest point and barycentric weights on a triangle projected into X/Z. */
function closestPointOnTriangleXZ(
  x: number,
  z: number,
  triangle: AsphaltTriangleSurface,
): ClosestTrianglePoint {
  const { a, b, c } = triangle
  const abX = b.x - a.x
  const abZ = b.z - a.z
  const acX = c.x - a.x
  const acZ = c.z - a.z
  const apX = x - a.x
  const apZ = z - a.z
  const abAb = abX * abX + abZ * abZ
  const abAc = abX * acX + abZ * acZ
  const acAc = acX * acX + acZ * acZ
  const apAb = apX * abX + apZ * abZ
  const apAc = apX * acX + apZ * acZ
  const denominator = abAb * acAc - abAc * abAc

  if (Math.abs(denominator) > 1e-12) {
    const weightB = (acAc * apAb - abAc * apAc) / denominator
    const weightC = (abAb * apAc - abAc * apAb) / denominator
    const weightA = 1 - weightB - weightC
    if (weightA >= 0 && weightB >= 0 && weightC >= 0) {
      return {
        distanceSquared: 0,
        weightA,
        weightB,
        weightC,
        x,
        z,
      }
    }
  }

  let best: ClosestTrianglePoint | null = null
  const considerEdge = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    startWeights: readonly [number, number, number],
    endWeights: readonly [number, number, number],
  ) => {
    const edgeX = end.x - start.x
    const edgeZ = end.z - start.z
    const lengthSquared = edgeX * edgeX + edgeZ * edgeZ
    const alpha =
      lengthSquared > 1e-12
        ? Math.min(
            1,
            Math.max(
              0,
              ((x - start.x) * edgeX + (z - start.z) * edgeZ) / lengthSquared,
            ),
          )
        : 0
    const closestX = start.x + edgeX * alpha
    const closestZ = start.z + edgeZ * alpha
    const deltaX = x - closestX
    const deltaZ = z - closestZ
    const candidate: ClosestTrianglePoint = {
      distanceSquared: deltaX * deltaX + deltaZ * deltaZ,
      weightA: startWeights[0] + (endWeights[0] - startWeights[0]) * alpha,
      weightB: startWeights[1] + (endWeights[1] - startWeights[1]) * alpha,
      weightC: startWeights[2] + (endWeights[2] - startWeights[2]) * alpha,
      x: closestX,
      z: closestZ,
    }
    if (!best || candidate.distanceSquared < best.distanceSquared) {
      best = candidate
    }
  }

  considerEdge(a, b, [1, 0, 0], [0, 1, 0])
  considerEdge(b, c, [0, 1, 0], [0, 0, 1])
  considerEdge(c, a, [0, 0, 1], [1, 0, 0])
  return best as unknown as ClosestTrianglePoint
}

/**
 * Build a tiny X/Z spatial index over the actual asphalt triangles. Unlike a
 * per-frame downward ray, nearest-surface projection cannot intermittently
 * miss the road and teleport the car to an unrelated fallback pose.
 */
export function createAsphaltProjector(
  meshes: THREE.Mesh[],
  materialPattern: RegExp = REPLAY_ROAD_MATERIAL_PATTERN,
): AsphaltProjector {
  const triangles: AsphaltTriangleSurface[] = []
  const cells = new Map<string, number[]>()

  const cellCoordinate = (value: number) =>
    Math.floor(value / ASPHALT_GRID_CELL_METERS)
  const cellKey = (x: number, z: number) => `${x}:${z}`

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const position = mesh.geometry.getAttribute('position')
    const normal = mesh.geometry.getAttribute('normal')
    const index = mesh.geometry.getIndex()
    if (!position) continue
    const indexCount = index?.count ?? position.count
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    const groups = mesh.geometry.groups
    let activeGroupIndex = 0
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)

    for (let offset = 0; offset + 2 < indexCount; offset += 3) {
      while (
        activeGroupIndex + 1 < groups.length &&
        offset >=
          groups[activeGroupIndex].start + groups[activeGroupIndex].count
      ) {
        activeGroupIndex += 1
      }
      const activeGroup = groups[activeGroupIndex]
      const materialIndex =
        groups.length > 0 &&
        offset >= activeGroup.start &&
        offset < activeGroup.start + activeGroup.count
          ? (activeGroup.materialIndex ?? 0)
          : 0
      const materialName = materials[materialIndex]?.name ?? null
      if (!materialName || !materialPattern.test(materialName)) continue
      const vertexIndex = (at: number) => index?.getX(at) ?? at
      const a = new THREE.Vector3()
        .fromBufferAttribute(position, vertexIndex(offset))
        .applyMatrix4(mesh.matrixWorld)
      const b = new THREE.Vector3()
        .fromBufferAttribute(position, vertexIndex(offset + 1))
        .applyMatrix4(mesh.matrixWorld)
      const c = new THREE.Vector3()
        .fromBufferAttribute(position, vertexIndex(offset + 2))
        .applyMatrix4(mesh.matrixWorld)
      const cross = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(b, a),
        new THREE.Vector3().subVectors(c, a),
      )
      const area = cross.length() * 0.5
      if (!Number.isFinite(area) || area <= 1e-8) continue
      const up = cross.normalize()
      if (up.y < 0) up.negate()
      const vertexNormal = (vertex: number) => {
        if (!normal) return up.clone()
        const candidate = new THREE.Vector3()
          .fromBufferAttribute(normal, vertex)
          .applyNormalMatrix(normalMatrix)
          .normalize()
        if (candidate.y < 0) candidate.negate()
        return candidate
      }

      const triangle: AsphaltTriangleSurface = {
        a,
        b,
        c,
        upA: vertexNormal(vertexIndex(offset)),
        upB: vertexNormal(vertexIndex(offset + 1)),
        upC: vertexNormal(vertexIndex(offset + 2)),
        materialName,
        area,
        minX: Math.min(a.x, b.x, c.x),
        maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z),
        maxZ: Math.max(a.z, b.z, c.z),
      }
      const triangleIndex = triangles.push(triangle) - 1
      for (
        let gridX = cellCoordinate(triangle.minX);
        gridX <= cellCoordinate(triangle.maxX);
        gridX += 1
      ) {
        for (
          let gridZ = cellCoordinate(triangle.minZ);
          gridZ <= cellCoordinate(triangle.maxZ);
          gridZ += 1
        ) {
          const key = cellKey(gridX, gridZ)
          const occupants = cells.get(key)
          if (occupants) occupants.push(triangleIndex)
          else cells.set(key, [triangleIndex])
        }
      }
    }
  }

  const seen = new Uint32Array(triangles.length)
  let generation = 0
  const cellRadius = Math.ceil(
    ASPHALT_PROJECTION_RADIUS_METERS / ASPHALT_GRID_CELL_METERS,
  )

  const nextGeneration = () => {
    generation += 1
    if (generation === 0xffffffff) {
      seen.fill(0)
      generation = 1
    }
    return generation
  }

  const pointIsInsideTriangleXZ = (
    x: number,
    z: number,
    triangle: AsphaltTriangleSurface,
  ) => {
    if (
      x < triangle.minX - 1e-6 ||
      x > triangle.maxX + 1e-6 ||
      z < triangle.minZ - 1e-6 ||
      z > triangle.maxZ + 1e-6
    ) {
      return false
    }
    return closestPointOnTriangleXZ(x, z, triangle).distanceSquared <= 1e-10
  }

  return {
    contains(x: number, z: number) {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(z) ||
        triangles.length === 0
      ) {
        return false
      }
      const activeGeneration = nextGeneration()
      const occupants = cells.get(cellKey(cellCoordinate(x), cellCoordinate(z)))
      if (!occupants) return false
      for (const triangleIndex of occupants) {
        if (seen[triangleIndex] === activeGeneration) continue
        seen[triangleIndex] = activeGeneration
        if (pointIsInsideTriangleXZ(x, z, triangles[triangleIndex])) return true
      }
      return false
    },
    project(x: number, z: number) {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(z) ||
        triangles.length === 0
      ) {
        return null
      }
      const activeGeneration = nextGeneration()

      const centerX = cellCoordinate(x)
      const centerZ = cellCoordinate(z)
      let bestTriangle: AsphaltTriangleSurface | null = null
      let bestPoint: ClosestTrianglePoint | null = null
      let bestY = Number.NEGATIVE_INFINITY
      const maximumDistanceSquared =
        ASPHALT_PROJECTION_RADIUS_METERS * ASPHALT_PROJECTION_RADIUS_METERS

      for (let deltaX = -cellRadius; deltaX <= cellRadius; deltaX += 1) {
        for (let deltaZ = -cellRadius; deltaZ <= cellRadius; deltaZ += 1) {
          const occupants = cells.get(
            cellKey(centerX + deltaX, centerZ + deltaZ),
          )
          if (!occupants) continue
          for (const triangleIndex of occupants) {
            if (seen[triangleIndex] === activeGeneration) continue
            seen[triangleIndex] = activeGeneration
            const triangle = triangles[triangleIndex]
            const closest = closestPointOnTriangleXZ(x, z, triangle)
            if (closest.distanceSquared > maximumDistanceSquared) continue
            const pointY =
              triangle.a.y * closest.weightA +
              triangle.b.y * closest.weightB +
              triangle.c.y * closest.weightC
            const isCloser =
              !bestPoint ||
              closest.distanceSquared < bestPoint.distanceSquared - 1e-9
            const isSamePlaceButHigher =
              bestPoint &&
              Math.abs(closest.distanceSquared - bestPoint.distanceSquared) <=
                1e-9 &&
              pointY > bestY
            if (isCloser || isSamePlaceButHigher) {
              bestTriangle = triangle
              bestPoint = closest
              bestY = pointY
            }
          }
        }
      }

      if (!bestTriangle || !bestPoint) return null
      return {
        point: new THREE.Vector3(bestPoint.x, bestY, bestPoint.z),
        up: bestTriangle.upA
          .clone()
          .multiplyScalar(bestPoint.weightA)
          .addScaledVector(bestTriangle.upB, bestPoint.weightB)
          .addScaledVector(bestTriangle.upC, bestPoint.weightC)
          .normalize(),
        surfaceMaterial: bestTriangle.materialName,
        surfaceArea: bestTriangle.area,
        distance: Math.sqrt(bestPoint.distanceSquared),
      }
    },
  }
}

function raycastDown(
  targets: THREE.Object3D[],
  x: number,
  z: number,
  fromY: number,
) {
  if (targets.length === 0) return null
  DOWN_RAYCASTER.ray.origin.set(x, fromY, z)
  DOWN_RAYCASTER.ray.direction.copy(DOWN)
  return DOWN_RAYCASTER.intersectObjects(targets, true)[0] ?? null
}

function triangleFromHit(
  hit: THREE.Intersection,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const mesh = hit.object as THREE.Mesh
  const position = mesh.geometry?.getAttribute?.('position')
  if (!hit.face || !position) return null
  return [hit.face.a, hit.face.b, hit.face.c].map((index) =>
    new THREE.Vector3()
      .fromBufferAttribute(position, index)
      .applyMatrix4(mesh.matrixWorld),
  ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
}

function surfaceUpFromHit(hit: THREE.Intersection, fallback = UP) {
  const triangle = triangleFromHit(hit)
  if (!triangle) return fallback.clone()
  const up = new THREE.Vector3()
    .crossVectors(
      new THREE.Vector3().subVectors(triangle[1], triangle[0]),
      new THREE.Vector3().subVectors(triangle[2], triangle[0]),
    )
    .normalize()
  if (up.y < 0) up.negate()
  return up
}

function longestTriangleEdge(hit: THREE.Intersection) {
  const triangle = triangleFromHit(hit)
  if (!triangle) return new THREE.Vector3(0, 0, 1)
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
    [triangle[0], triangle[1]],
    [triangle[1], triangle[2]],
    [triangle[2], triangle[0]],
  ]
  let winner = new THREE.Vector3(0, 0, 1)
  let winnerLength = -1
  for (const [start, end] of edges) {
    const candidate = new THREE.Vector3().subVectors(end, start)
    if (candidate.lengthSq() > winnerLength) {
      winner = candidate
      winnerLength = candidate.lengthSq()
    }
  }
  return winner
}

function headingOnSurface(heading: THREE.Vector3, up: THREE.Vector3) {
  const forward = heading.clone().addScaledVector(up, -heading.dot(up))
  if (!Number.isFinite(forward.x) || forward.lengthSq() < 1e-8) return null
  return forward.normalize()
}

/** Right-handed basis where the car model's local +Z is forward. */
export function poseFromBasis(forward: THREE.Vector3, up: THREE.Vector3) {
  const right = new THREE.Vector3().crossVectors(up, forward).normalize()
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, forward),
  )
  quaternion.multiply(
    new THREE.Quaternion().setFromAxisAngle(UP, CAR_YAW_OFFSET),
  )
  return {
    quaternion,
    forward: new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
  }
}

/** Geometry-derived fallback pose used before replay data has loaded. */
export function resolveCarPose(trackRoot: THREE.Object3D): CarPose {
  trackRoot.updateWorldMatrix(true, true)
  const asphalt = collectAsphaltMeshes(trackRoot)
  const targets: THREE.Object3D[] = asphalt.length > 0 ? asphalt : [trackRoot]
  const bounds = worldBounds(trackRoot)
  const dropHeight = Number.isFinite(bounds.max.y) ? bounds.max.y + 50 : 500
  const center = bounds.getCenter(new THREE.Vector3())
  const requestedX = CAR_SPAWN_XZ?.[0] ?? center.x
  const requestedZ = CAR_SPAWN_XZ?.[1] ?? center.z
  let hit = raycastDown(targets, requestedX, requestedZ, dropHeight)

  if (!hit && CAR_SPAWN_XZ) {
    hit = raycastDown(targets, center.x, center.z, dropHeight)
  }
  if (!hit) {
    return {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      forward: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      up: UP.clone(),
      source: 'origin',
      surfaceMaterial: null,
      surfaceArea: 0,
    }
  }

  let position = hit.point.clone()
  let up = surfaceUpFromHit(hit)
  const heading = longestTriangleEdge(hit)
  let forwardOnPlane = headingOnSurface(heading, up)
  if (!forwardOnPlane) forwardOnPlane = new THREE.Vector3(0, 0, 1)
  let { quaternion, forward, right } = poseFromBasis(forwardOnPlane, up)

  if (CAR_FORWARD_NUDGE !== 0 || CAR_LATERAL_NUDGE !== 0) {
    const candidate = position
      .clone()
      .addScaledVector(forward, CAR_FORWARD_NUDGE)
      .addScaledVector(right, CAR_LATERAL_NUDGE)
    const nudgedHit = raycastDown(targets, candidate.x, candidate.z, dropHeight)
    if (nudgedHit) {
      hit = nudgedHit
      position = nudgedHit.point.clone()
      up = surfaceUpFromHit(nudgedHit, up)
      forwardOnPlane = headingOnSurface(heading, up) ?? forwardOnPlane
      const adjustedBasis = poseFromBasis(forwardOnPlane, up)
      quaternion = adjustedBasis.quaternion
      forward = adjustedBasis.forward
      right = adjustedBasis.right
    }
  }

  position.addScaledVector(up, CAR_GROUND_EPSILON)
  return {
    position,
    quaternion,
    forward,
    right,
    up,
    source: CAR_SPAWN_XZ ? 'spawn-override' : 'raycast',
    surfaceMaterial: materialNames(hit.object as THREE.Mesh)[0] ?? null,
    surfaceArea: 0,
  }
}

/** Resolve one replay sample onto the actual road mesh. */
export function resolveReplayCarPose(
  asphaltProjector: AsphaltProjector,
  samples: ReplayLocationSample[],
  tMs: number,
  fallback: CarPose,
  durationMs?: number,
  lateralNudge = 0,
  smoothMotion = false,
  motionRoute: ReplayMotionRoute | null = null,
  routeSampleOverride: ReplayMotionSample | null = null,
): CarPose {
  const linearLocation = interpolateLocation(samples, tMs, durationMs)
  const routeSample = smoothMotion
    ? routeSampleOverride ?? motionRoute?.sample(tMs)
    : null
  const current =
    smoothMotion && !routeSample
      ? interpolateSmoothedLocation(samples, tMs, durationMs)
      : linearLocation
  if (!current || !linearLocation) return fallback

  let plane = routeSample
    ? { x: routeSample.position.x, z: routeSample.position.z }
    : openF1ToTrackPlane(current)
  const linearPlane = openF1ToTrackPlane(linearLocation)
  if (!routeSample) {
    const offset = Math.hypot(plane.x - linearPlane.x, plane.z - linearPlane.z)
    if (offset > REPLAY_SPLINE_MAX_DEVIATION) {
      const alpha = REPLAY_SPLINE_MAX_DEVIATION / offset
      plane = {
        x: linearPlane.x + (plane.x - linearPlane.x) * alpha,
        z: linearPlane.z + (plane.z - linearPlane.z) * alpha,
      }
    }
  }

  const heading = routeSample
    ? routeSample.heading.clone()
    : (() => {
        const headingSamples = interpolateHeading(
          samples,
          tMs,
          durationMs,
          smoothMotion,
          smoothMotion ? REPLAY_HEADING_WINDOW_MS : 120,
        )
        if (!headingSamples) return fallback.forward.clone()
        const previous = openF1ToTrackPlane(headingSamples.previous)
        const next = openF1ToTrackPlane(headingSamples.next)
        return new THREE.Vector3(next.x - previous.x, 0, next.z - previous.z)
      })()

  let projection = asphaltProjector.project(plane.x, plane.z)
  // Keep X/Z on the route plane when asphalt misses. Full spawn fallback can
  // teleport the car through the map when the projector briefly loses the road.
  if (!projection) {
    const missUp = UP.clone()
    const missForward = headingOnSurface(heading, missUp) ?? fallback.forward
    const missBasis = poseFromBasis(missForward, missUp)
    return {
      position: new THREE.Vector3(plane.x, fallback.position.y, plane.z),
      quaternion: missBasis.quaternion,
      forward: missBasis.forward,
      right: missBasis.right,
      up: missUp,
      source: 'replay-location',
      surfaceMaterial: fallback.surfaceMaterial,
      surfaceArea: fallback.surfaceArea,
    }
  }
  let up = REPLAY_SURFACE_BANKING ? projection.up : UP.clone()
  let forwardOnPlane = headingOnSurface(heading, up)
  if (!forwardOnPlane) return fallback
  let { quaternion, forward, right } = poseFromBasis(forwardOnPlane, up)
  // The smooth speed route is authoritative in X/Z. Nearest-triangle X/Z can
  // switch between road branches or opposite edges in a single frame; use the
  // projector only for continuous road height and banking information.
  const position = new THREE.Vector3(plane.x, projection.point.y, plane.z)

  if (lateralNudge !== 0) {
    const candidate = position.clone().addScaledVector(right, lateralNudge)
    const nudgedProjection = asphaltProjector.project(candidate.x, candidate.z)
    if (nudgedProjection) {
      projection = nudgedProjection
      position.set(candidate.x, nudgedProjection.point.y, candidate.z)
      up = REPLAY_SURFACE_BANKING ? nudgedProjection.up : UP.clone()
      forwardOnPlane = headingOnSurface(heading, up)
      if (!forwardOnPlane) return fallback
      const adjustedBasis = poseFromBasis(forwardOnPlane, up)
      quaternion = adjustedBasis.quaternion
      forward = adjustedBasis.forward
      right = adjustedBasis.right
    }
  }

  position.addScaledVector(up, CAR_GROUND_EPSILON)
  return {
    position,
    quaternion,
    forward,
    right,
    up,
    source: 'replay-location',
    surfaceMaterial: projection.surfaceMaterial,
    surfaceArea: projection.surfaceArea,
  }
}
