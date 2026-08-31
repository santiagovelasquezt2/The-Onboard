import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import 'tsx/esm'

const { createAsphaltProjector } = await import(
  '../../../src/features/replay/scene/carPose.ts'
)

const EPSILON = 1e-9

function assertApproximately(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${label}: expected ${expected}, received ${actual}`,
  )
}

function assertVectorApproximately(actual, expected, label) {
  for (let axis = 0; axis < 3; axis += 1) {
    assertApproximately(actual.getComponent(axis), expected[axis], `${label}[${axis}]`)
  }
}

function asphaltTriangle({
  positions,
  normals,
  materialName = 'RoadMat',
}) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  if (normals) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3),
    )
  }
  geometry.setIndex([0, 1, 2])
  const material = new THREE.MeshStandardMaterial()
  material.name = materialName
  return new THREE.Mesh(geometry, material)
}

test('asphalt projection preserves barycentric point, normal, area, and edge math', () => {
  const mesh = asphaltTriangle({
    positions: [0, 1, 0, 10, 5, 0, 0, 9, 10],
    normals: [0, 1, 0, 1, 1, 0, 0, 1, 1],
  })
  const projector = createAsphaltProjector([mesh], /RoadMat/u)

  const inside = projector.project(2, 3)
  assert.ok(inside)
  assertVectorApproximately(inside.point, [2, 4.2, 3], 'inside point')
  assertApproximately(inside.distance, 0, 'inside distance')
  assert.equal(inside.surfaceMaterial, 'RoadMat')

  const normalizedDiagonal = Math.SQRT1_2
  const expectedInsideUp = new THREE.Vector3(
    0.2 * normalizedDiagonal,
    0.5 + 0.5 * normalizedDiagonal,
    0.3 * normalizedDiagonal,
  ).normalize()
  assertVectorApproximately(
    inside.up,
    expectedInsideUp.toArray(),
    'inside normal',
  )

  const expectedArea = new THREE.Triangle(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(10, 5, 0),
    new THREE.Vector3(0, 9, 10),
  ).getArea()
  assertApproximately(inside.surfaceArea, expectedArea, 'surface area')

  const outside = projector.project(8, 8)
  assert.ok(outside)
  assertVectorApproximately(outside.point, [5, 7, 5], 'edge point')
  assertApproximately(outside.distance, Math.sqrt(18), 'edge distance')

  const expectedOutsideUp = new THREE.Vector3(
    0.5 * normalizedDiagonal,
    normalizedDiagonal,
    0.5 * normalizedDiagonal,
  ).normalize()
  assertVectorApproximately(
    outside.up,
    expectedOutsideUp.toArray(),
    'edge normal',
  )
})

test('equal XZ projections select the higher overlapping road surface', () => {
  const low = asphaltTriangle({
    positions: [0, 0, 0, 10, 0, 0, 0, 0, 10],
  })
  const high = asphaltTriangle({
    positions: [0, 5, 0, 10, 5, 0, 0, 5, 10],
  })
  const projector = createAsphaltProjector([low, high], /RoadMat/u)

  const projection = projector.project(2, 3)
  assert.ok(projection)
  assertVectorApproximately(projection.point, [2, 5, 3], 'overlap point')
  assertApproximately(projection.distance, 0, 'overlap distance')
})

test('scratch reuse never mutates a previously returned projection', () => {
  const mesh = asphaltTriangle({
    positions: [0, 1, 0, 10, 5, 0, 0, 9, 10],
    normals: [0, 1, 0, 1, 1, 0, 0, 1, 1],
  })
  const projector = createAsphaltProjector([mesh], /RoadMat/u)

  const first = projector.project(1, 1)
  assert.ok(first)
  const firstPoint = first.point.clone()
  const firstUp = first.up.clone()

  const second = projector.project(8, 8)
  assert.ok(second)
  assert.notStrictEqual(first, second)
  assert.notStrictEqual(first.point, second.point)
  assert.notStrictEqual(first.up, second.up)
  assert.deepEqual(first.point.toArray(), firstPoint.toArray())
  assert.deepEqual(first.up.toArray(), firstUp.toArray())
})

test('contains and projection rejection preserve boundary and radius behavior', () => {
  const mesh = asphaltTriangle({
    positions: [0, 0, 0, 10, 0, 0, 0, 0, 10],
  })
  const projector = createAsphaltProjector([mesh], /RoadMat/u)

  assert.equal(projector.contains(2, 3), true)
  assert.equal(projector.contains(5, 5), true)
  assert.equal(projector.contains(8, 8), false)
  assert.equal(projector.contains(Number.POSITIVE_INFINITY, 0), false)
  assert.equal(projector.project(Number.NaN, 0), null)
  assert.equal(projector.project(100, 100), null)
})
