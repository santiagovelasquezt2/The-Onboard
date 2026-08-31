import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import {
  batchStaticCarMeshes,
  createBatchedTrackRender,
  disposeGeneratedBatchedMeshes,
} from '../../../src/features/replay/scene/sceneOptimization.ts'

function roundedBox(box) {
  return [...box.min.toArray(), ...box.max.toArray()].map((value) =>
    Number(value.toFixed(6)),
  )
}

function assertMatrixAlmostEqual(actual, expected) {
  for (const [index, value] of actual.elements.entries()) {
    assert.ok(
      Math.abs(value - expected.elements[index]) <= 2e-6,
      `matrix element ${index} changed from ${expected.elements[index]} to ${value}`,
    )
  }
}

function visibleGeometryBox(root) {
  root.updateWorldMatrix(true, true)
  const result = new THREE.Box3().makeEmpty()

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return

    if (object instanceof THREE.BatchedMesh) {
      const geometryBox = new THREE.Box3()
      const instanceMatrix = new THREE.Matrix4()
      for (let instanceId = 0; instanceId < object.instanceCount; instanceId += 1) {
        if (!object.getVisibleAt(instanceId)) continue
        object.getBoundingBoxAt(object.getGeometryIdAt(instanceId), geometryBox)
        object.getMatrixAt(instanceId, instanceMatrix)
        instanceMatrix.premultiply(object.matrixWorld)
        result.union(geometryBox.clone().applyMatrix4(instanceMatrix))
      }
      return
    }

    if (object.geometry.boundingBox === null) {
      object.geometry.computeBoundingBox()
    }
    result.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld))
  })

  return result
}

function triangleGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 0.5, 0.5],
      3,
    ),
  )
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
  )
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2),
  )
  geometry.setIndex([0, 1, 2])
  return geometry
}

test('track primitives sharing a material become one cullable batch', () => {
  const source = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()
  material.name = 'AsphaltMat'

  for (const x of [-100, 0, 100]) {
    const mesh = new THREE.Mesh(triangleGeometry(), material)
    mesh.position.x = x
    mesh.receiveShadow = true
    source.add(mesh)
  }

  const before = new THREE.Box3().setFromObject(source)
  const { root, stats } = createBatchedTrackRender(source)
  const after = new THREE.Box3().setFromObject(root)
  const batches = root.children.filter(
    (object) => object instanceof THREE.BatchedMesh,
  )

  assert.equal(source.children.length, 3)
  assert.equal(stats.sourceMeshes, 3)
  assert.equal(stats.sourceDrawCalls, 3)
  assert.equal(stats.batchedMeshes, 1)
  assert.equal(stats.batchedInstances, 3)
  assert.equal(stats.renderObjects, 1)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].perObjectFrustumCulled, true)
  assert.deepEqual(roundedBox(after), roundedBox(before))
})

test('car batching preserves every authored wheel primitive pose and bounds', () => {
  const car = new THREE.Group()
  car.position.set(4, 0.5, -3)
  car.rotation.set(0.04, -0.2, 0.01)
  car.scale.set(1.1, 0.95, 1.05)

  const bodyMaterial = new THREE.MeshStandardMaterial()
  bodyMaterial.name = 'mercedes_paint'

  for (const x of [-1, 0, 1]) {
    const mesh = new THREE.Mesh(triangleGeometry(), bodyMaterial)
    mesh.position.x = x
    mesh.castShadow = true
    mesh.receiveShadow = true
    car.add(mesh)
  }

  const hubMaterial = new THREE.MeshStandardMaterial()
  hubMaterial.name = 'mercedes_wheel_hub'
  const tireMaterial = new THREE.MeshStandardMaterial()
  tireMaterial.name = 'TIRE_TREAD'
  const wheelMeshes = []
  const wheelGroups = []
  const corners = [
    ['LF', 1.5, 0.55, 0.02],
    ['RF', 1.5, -0.55, -0.02],
    ['RR', -1.5, -0.55, 0.015],
    ['LR', -1.5, 0.55, -0.015],
  ]

  for (const [corner, x, z, steer] of corners) {
    const wheel = new THREE.Group()
    wheel.name = `WHEEL_${corner}_test`
    wheel.position.set(x, -0.2, z)
    wheel.quaternion.setFromEuler(
      new THREE.Euler(Math.PI / 2, steer, corner.endsWith('F') ? -0.01 : 0.01),
    )

    const authoredPrimitive = new THREE.Group()
    authoredPrimitive.position.set(0.03, corner.startsWith('R') ? -0.02 : 0.02, 0)
    authoredPrimitive.rotation.z = corner.endsWith('F') ? 0.04 : -0.03

    const hub = new THREE.Mesh(triangleGeometry(), hubMaterial)
    hub.name = `WHEEL_${corner}_hub`
    hub.position.set(0, 0.01, 0.015)
    hub.scale.set(0.36, 0.36, 0.36)
    hub.castShadow = true
    hub.receiveShadow = true

    const tire = new THREE.Mesh(triangleGeometry(), tireMaterial)
    tire.name = `WHEEL_${corner}_tire`
    tire.position.set(0, -0.015, -0.02)
    tire.rotation.y = Math.PI / 8
    tire.scale.set(0.52, 0.52, 0.52)
    tire.castShadow = true
    tire.receiveShadow = true

    authoredPrimitive.add(hub, tire)
    wheel.add(authoredPrimitive)
    car.add(wheel)
    wheelGroups.push(wheel)
    wheelMeshes.push(hub, tire)
  }

  car.updateWorldMatrix(true, true)
  const rootWorldInverse = car.matrixWorld.clone().invert()
  const authoredMatricesByMaterial = new Map()
  for (const mesh of wheelMeshes) {
    const matrices = authoredMatricesByMaterial.get(mesh.material) ?? []
    matrices.push(
      new THREE.Matrix4().multiplyMatrices(
        rootWorldInverse,
        mesh.matrixWorld,
      ),
    )
    authoredMatricesByMaterial.set(mesh.material, matrices)
  }
  const authoredWheelPoses = wheelGroups.map((wheel) => ({
    position: wheel.position.toArray(),
    quaternion: wheel.quaternion.toArray(),
    scale: wheel.scale.toArray(),
  }))

  const before = visibleGeometryBox(car)
  const stats = batchStaticCarMeshes(car)
  const after = visibleGeometryBox(car)
  const batches = car.children.filter(
    (object) =>
      object instanceof THREE.BatchedMesh &&
      object.name.startsWith('OPTIMIZED_STATIC_'),
  )

  assert.equal(stats.sourceMeshes, 11)
  assert.equal(stats.visibleSourceMeshes, 11)
  assert.equal(stats.eligibleMeshes, 11)
  assert.equal(stats.batchedSourceMeshes, 11)
  assert.equal(stats.batchedMeshes, 3)
  assert.equal(stats.retainedMeshes, 3)
  assert.equal(batches.length, 3)

  for (const [material, authoredMatrices] of authoredMatricesByMaterial) {
    const batch = batches.find((candidate) => candidate.material === material)
    assert.ok(batch instanceof THREE.BatchedMesh)
    assert.equal(batch.userData.theonboardBatchedStaticMeshes, 4)
    assert.equal(batch.castShadow, true)
    assert.equal(batch.receiveShadow, true)
    assert.equal(batch.perObjectFrustumCulled, true)

    for (const [instanceId, authoredMatrix] of authoredMatrices.entries()) {
      const matrix = new THREE.Matrix4()
      batch.getMatrixAt(instanceId, matrix)
      assertMatrixAlmostEqual(matrix, authoredMatrix)
    }
  }

  for (const [index, wheel] of wheelGroups.entries()) {
    assert.deepEqual(wheel.position.toArray(), authoredWheelPoses[index].position)
    assert.deepEqual(
      wheel.quaternion.toArray(),
      authoredWheelPoses[index].quaternion,
    )
    assert.deepEqual(wheel.scale.toArray(), authoredWheelPoses[index].scale)
  }
  for (const mesh of wheelMeshes) {
    assert.equal(car.getObjectByName(mesh.name), undefined)
  }
  assert.deepEqual(roundedBox(after), roundedBox(before))
})

test('car batching preserves quantized positions through node transforms', () => {
  const car = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()

  for (const x of [-4, 4]) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Int16BufferAttribute(
        [-16384, 0, -16384, 16384, 0, -16384, 0, 16384, 16384],
        3,
        true,
      ),
    )
    geometry.setAttribute(
      'normal',
      new THREE.Int8BufferAttribute([0, 127, 0, 0, 127, 0, 0, 127, 0], 3, true),
    )
    geometry.setIndex([0, 1, 2])
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.x = x
    car.add(mesh)
  }

  const before = new THREE.Box3().setFromObject(car)
  batchStaticCarMeshes(car)
  const after = new THREE.Box3().setFromObject(car)
  const batch = car.children.find(
    (object) => object instanceof THREE.BatchedMesh,
  )

  assert.ok(batch instanceof THREE.BatchedMesh)
  assert.deepEqual(roundedBox(after), roundedBox(before))
})

test('transparent car pieces retain independent meshes for sorting', () => {
  const car = new THREE.Group()
  const glass = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.5,
  })
  for (const x of [-1, 1]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glass)
    mesh.position.x = x
    car.add(mesh)
  }

  const stats = batchStaticCarMeshes(car)
  assert.equal(stats.sourceMeshes, 2)
  assert.equal(stats.visibleSourceMeshes, 2)
  assert.equal(stats.eligibleMeshes, 0)
  assert.equal(stats.batchedMeshes, 0)
  assert.equal(car.children.length, 2)
})

test('car stats exclude hidden leaves from retained render meshes', () => {
  const car = new THREE.Group()
  const material = new THREE.MeshStandardMaterial()
  for (const x of [-1, 1]) {
    const mesh = new THREE.Mesh(triangleGeometry(), material)
    mesh.position.x = x
    car.add(mesh)
  }
  const hiddenMesh = new THREE.Mesh(triangleGeometry(), material)
  hiddenMesh.visible = false
  car.add(hiddenMesh)

  const stats = batchStaticCarMeshes(car)
  assert.equal(stats.sourceMeshes, 3)
  assert.equal(stats.visibleSourceMeshes, 2)
  assert.equal(stats.batchedSourceMeshes, 2)
  assert.equal(stats.batchedMeshes, 1)
  assert.equal(stats.retainedMeshes, 1)
})

test('generated batch teardown is owned, resource-safe, and idempotent', () => {
  const sharedTexture = new THREE.Texture()
  const sharedMaterial = new THREE.MeshStandardMaterial({ map: sharedTexture })
  const sharedGeometry = triangleGeometry()
  const source = new THREE.Group()
  for (const x of [-1, 0, 1]) {
    const mesh = new THREE.Mesh(sharedGeometry, sharedMaterial)
    mesh.position.x = x
    source.add(mesh)
  }

  const { root: trackRoot } = createBatchedTrackRender(source)
  const carRoot = new THREE.Group()
  for (const x of [-1, 1]) {
    const mesh = new THREE.Mesh(sharedGeometry, sharedMaterial)
    mesh.position.x = x
    carRoot.add(mesh)
  }
  batchStaticCarMeshes(carRoot)

  const teardownRoot = new THREE.Group()
  teardownRoot.add(trackRoot, carRoot)
  const unownedBatch = new THREE.BatchedMesh(1, 3, 3, sharedMaterial)
  teardownRoot.add(unownedBatch)

  const generatedBatches = []
  teardownRoot.traverse((object) => {
    if (
      object instanceof THREE.BatchedMesh &&
      object.userData.theonboardOwnedGeneratedBatch === true
    ) {
      generatedBatches.push(object)
    }
  })
  assert.equal(generatedBatches.length, 2)

  let generatedDisposeCalls = 0
  for (const batch of generatedBatches) {
    const dispose = batch.dispose.bind(batch)
    batch.dispose = () => {
      generatedDisposeCalls += 1
      dispose()
    }
  }
  let unownedDisposeCalls = 0
  unownedBatch.dispose = () => {
    unownedDisposeCalls += 1
  }
  let sourceGeometryDisposeEvents = 0
  let sourceMaterialDisposeEvents = 0
  let sourceTextureDisposeEvents = 0
  sharedGeometry.addEventListener('dispose', () => {
    sourceGeometryDisposeEvents += 1
  })
  sharedMaterial.addEventListener('dispose', () => {
    sourceMaterialDisposeEvents += 1
  })
  sharedTexture.addEventListener('dispose', () => {
    sourceTextureDisposeEvents += 1
  })

  assert.equal(disposeGeneratedBatchedMeshes(teardownRoot), 2)
  assert.equal(disposeGeneratedBatchedMeshes(teardownRoot), 0)
  assert.equal(generatedDisposeCalls, 2)
  assert.equal(unownedDisposeCalls, 0)
  assert.equal(sourceGeometryDisposeEvents, 0)
  assert.equal(sourceMaterialDisposeEvents, 0)
  assert.equal(sourceTextureDisposeEvents, 0)
})
