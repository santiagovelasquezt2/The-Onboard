import * as THREE from 'three'

const STATIC_CAR_BATCH_PREFIX = 'OPTIMIZED_STATIC_'
const TRACK_BATCH_PREFIX = 'OPTIMIZED_TRACK_'
const OWNED_GENERATED_BATCH_KEY = 'theonboardOwnedGeneratedBatch'
const DISPOSED_GENERATED_BATCH_KEY = 'theonboardGeneratedBatchDisposed'

type TrackBatchEntry = {
  mesh: THREE.Mesh
  material: THREE.Material
  matrix: THREE.Matrix4
}

export type TrackBatchStats = {
  sourceMeshes: number
  sourceDrawCalls: number
  batchedMeshes: number
  batchedInstances: number
  fallbackMeshes: number
  renderObjects: number
}

export type CarBatchStats = {
  sourceMeshes: number
  visibleSourceMeshes: number
  eligibleMeshes: number
  batchedSourceMeshes: number
  batchedMeshes: number
  retainedMeshes: number
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '')
}

function geometrySignature(geometry: THREE.BufferGeometry): string | null {
  const position = geometry.getAttribute('position')
  if (!position || Object.keys(geometry.morphAttributes).length > 0) return null
  if (geometry.groups.length > 1) return null

  const attributes = Object.entries(geometry.attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => {
      const array = attribute.array
      return [
        name,
        attribute.itemSize,
        attribute.normalized ? 1 : 0,
        array.constructor.name,
        'gpuType' in attribute ? attribute.gpuType : '',
      ].join(':')
    })
    .join('|')

  return `${geometry.index ? 'indexed' : 'non-indexed'}|${attributes}`
}

function relativeMatrix(
  rootWorldInverse: THREE.Matrix4,
  object: THREE.Object3D,
): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(
    rootWorldInverse,
    object.matrixWorld,
  )
}

function cloneFlatMesh(
  source: THREE.Mesh,
  matrix: THREE.Matrix4,
): THREE.Mesh {
  const clone = new THREE.Mesh(source.geometry, source.material)
  clone.name = source.name
  clone.matrix.copy(matrix)
  clone.matrixAutoUpdate = false
  clone.castShadow = source.castShadow
  clone.receiveShadow = source.receiveShadow
  clone.frustumCulled = source.frustumCulled
  clone.renderOrder = source.renderOrder
  clone.layers.mask = source.layers.mask
  clone.userData = { ...source.userData }
  return clone
}

function markOwnedGeneratedBatch(batch: THREE.BatchedMesh): void {
  batch.userData[OWNED_GENERATED_BATCH_KEY] = true
}

/**
 * Releases only BatchedMesh resources allocated by this optimizer. Source GLTF
 * geometry, materials, textures, and unowned BatchedMeshes are never disposed.
 * Returns the number of batches released during this call.
 */
export function disposeGeneratedBatchedMeshes(root: THREE.Object3D): number {
  let disposedBatches = 0

  root.traverse((object) => {
    if (
      !(object instanceof THREE.BatchedMesh) ||
      object.userData[OWNED_GENERATED_BATCH_KEY] !== true ||
      object.userData[DISPOSED_GENERATED_BATCH_KEY] === true
    ) {
      return
    }

    object.userData[DISPOSED_GENERATED_BATCH_KEY] = true
    object.dispose()
    disposedBatches += 1
  })

  return disposedBatches
}

/**
 * Builds a render-only track hierarchy. The source hierarchy remains untouched
 * for replay raycasts and calibration, while compatible primitives are grouped
 * by material into BatchedMesh multi-draw objects. Each spatial tile remains a
 * separate batch instance, so Three can frustum-cull it independently.
 */
export function createBatchedTrackRender(
  sourceRoot: THREE.Group,
): { root: THREE.Group; stats: TrackBatchStats } {
  sourceRoot.updateWorldMatrix(true, true)
  const rootWorldInverse = sourceRoot.matrixWorld.clone().invert()
  const root = new THREE.Group()
  root.name = 'MontrealTrackRuntimeBatches'

  const grouped = new Map<string, TrackBatchEntry[]>()
  const fallbacks: Array<{ mesh: THREE.Mesh; matrix: THREE.Matrix4 }> = []
  let sourceMeshes = 0
  let sourceDrawCalls = 0

  sourceRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return
    sourceMeshes += 1
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    sourceDrawCalls += materials.filter((material) => material?.visible).length

    const matrix = relativeMatrix(rootWorldInverse, object)
    const material = Array.isArray(object.material) ? null : object.material
    const signature = geometrySignature(object.geometry)
    const canBatch =
      material !== null &&
      material.visible &&
      signature !== null &&
      matrix.determinant() >= 0

    if (!canBatch) {
      fallbacks.push({ mesh: object, matrix })
      return
    }

    const key = [
      material.uuid,
      signature,
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
      object.renderOrder,
    ].join('::')
    const entries = grouped.get(key) ?? []
    entries.push({ mesh: object, material, matrix })
    grouped.set(key, entries)
  })

  let batchedMeshes = 0
  let batchedInstances = 0
  let fallbackMeshes = 0

  for (const entries of grouped.values()) {
    if (entries.length === 1) {
      const entry = entries[0]
      root.add(cloneFlatMesh(entry.mesh, entry.matrix))
      fallbackMeshes += 1
      continue
    }

    const maxVertexCount = entries.reduce(
      (total, entry) =>
        total + entry.mesh.geometry.getAttribute('position').count,
      0,
    )
    const maxIndexCount = entries.reduce(
      (total, entry) => total + (entry.mesh.geometry.index?.count ?? 0),
      0,
    )
    const first = entries[0]
    const batch = new THREE.BatchedMesh(
      entries.length,
      maxVertexCount,
      maxIndexCount,
      first.material,
    )
    batch.name = `${TRACK_BATCH_PREFIX}${safeName(first.material.name || 'material')}`
    batch.castShadow = first.mesh.castShadow
    batch.receiveShadow = first.mesh.receiveShadow
    batch.renderOrder = first.mesh.renderOrder
    batch.layers.mask = first.mesh.layers.mask
    batch.perObjectFrustumCulled = true
    batch.sortObjects = first.material.transparent
    markOwnedGeneratedBatch(batch)

    for (const entry of entries) {
      const geometryId = batch.addGeometry(entry.mesh.geometry)
      const instanceId = batch.addInstance(geometryId)
      batch.setMatrixAt(instanceId, entry.matrix)
    }
    batch.computeBoundingBox()
    batch.computeBoundingSphere()
    root.add(batch)
    batchedMeshes += 1
    batchedInstances += entries.length
  }

  for (const fallback of fallbacks) {
    root.add(cloneFlatMesh(fallback.mesh, fallback.matrix))
    fallbackMeshes += 1
  }

  return {
    root,
    stats: {
      sourceMeshes,
      sourceDrawCalls,
      batchedMeshes,
      batchedInstances,
      fallbackMeshes,
      renderObjects: batchedMeshes + fallbackMeshes,
    },
  }
}

/**
 * Batches static, opaque car leaves, including compatible wheel primitives.
 * Each leaf keeps its authored root-relative transform, while transparent
 * pieces retain their independent sorting behavior. Per-object culling is
 * important for T-cam: panels behind the lens should not be paid for just
 * because another panel using the same material is visible.
 */
export function batchStaticCarMeshes(root: THREE.Group): CarBatchStats {
  root.updateWorldMatrix(true, true)
  const rootWorldInverse = root.matrixWorld.clone().invert()
  const candidates = new Map<
    string,
    Array<{
      mesh: THREE.Mesh
      material: THREE.Material
      matrix: THREE.Matrix4
    }>
  >()
  let sourceMeshes = 0
  let visibleSourceMeshes = 0
  let eligibleMeshes = 0

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    sourceMeshes += 1
    if (object.visible) visibleSourceMeshes += 1
    if (
      object.name.startsWith(STATIC_CAR_BATCH_PREFIX) ||
      !object.visible ||
      object.children.length > 0 ||
      object instanceof THREE.SkinnedMesh ||
      Array.isArray(object.material) ||
      !object.material.visible ||
      object.material.transparent ||
      object.material.opacity < 1
    ) {
      return
    }

    const signature = geometrySignature(object.geometry)
    if (!signature) return
    const matrix = relativeMatrix(rootWorldInverse, object)
    // BatchedMesh forbids negative transforms; retaining the rare mirrored
    // leaf is safer than changing winding and tangent handedness at runtime.
    if (matrix.determinant() < 0) return

    eligibleMeshes += 1
    const key = [
      object.material.uuid,
      signature,
      object.castShadow ? 1 : 0,
      object.receiveShadow ? 1 : 0,
      object.renderOrder,
    ].join('::')
    const entries = candidates.get(key) ?? []
    entries.push({ mesh: object, material: object.material, matrix })
    candidates.set(key, entries)
  })

  let batchedSourceMeshes = 0
  let batchedMeshes = 0

  for (const entries of candidates.values()) {
    if (entries.length < 2) continue
    const first = entries[0]
    const maxVertexCount = entries.reduce(
      (total, entry) =>
        total + entry.mesh.geometry.getAttribute('position').count,
      0,
    )
    const maxIndexCount = entries.reduce(
      (total, entry) => total + (entry.mesh.geometry.index?.count ?? 0),
      0,
    )
    const batch = new THREE.BatchedMesh(
      entries.length,
      maxVertexCount,
      maxIndexCount,
      first.material,
    )
    batch.name = `${STATIC_CAR_BATCH_PREFIX}${safeName(first.material.name || 'material')}_${batchedMeshes}`
    batch.castShadow = first.mesh.castShadow
    batch.receiveShadow = first.mesh.receiveShadow
    batch.renderOrder = first.mesh.renderOrder
    batch.layers.mask = first.mesh.layers.mask
    batch.perObjectFrustumCulled = true
    batch.sortObjects = false
    batch.userData.theonboardBatchedStaticMeshes = entries.length
    markOwnedGeneratedBatch(batch)

    for (const entry of entries) {
      const geometryId = batch.addGeometry(entry.mesh.geometry)
      const instanceId = batch.addInstance(geometryId)
      batch.setMatrixAt(instanceId, entry.matrix)
    }
    batch.computeBoundingBox()
    batch.computeBoundingSphere()
    root.add(batch)

    for (const entry of entries) entry.mesh.removeFromParent()
    batchedSourceMeshes += entries.length
    batchedMeshes += 1
  }

  root.updateWorldMatrix(true, true)
  return {
    sourceMeshes,
    visibleSourceMeshes,
    eligibleMeshes,
    batchedSourceMeshes,
    batchedMeshes,
    retainedMeshes: visibleSourceMeshes - batchedSourceMeshes + batchedMeshes,
  }
}
