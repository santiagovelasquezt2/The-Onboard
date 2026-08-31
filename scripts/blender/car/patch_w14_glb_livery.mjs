#!/usr/bin/env node

/**
 * Merge Blender-authored livery images/materials into the existing GLB while
 * preserving every original node transform, accessor, and geometry byte.
 *
 * Blender re-export legitimately re-splits some vertices at attribute seams,
 * but this task is color-only. Appending replacement PNGs to the original BIN
 * chunk avoids any geometric or hierarchy serialization drift.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sourcePath = process.argv[2] ?? path.join(
  projectRoot,
  'tmp/mercedes-2024-livery/baseline/amg-w14-before-2024-livery.glb',
)
const outputPath = process.argv[3] ?? path.join(
  projectRoot,
  'tmp/mercedes-2024-livery/final/amg-w14-2024-color-only.glb',
)
const textureDir = process.argv[4] ?? path.join(
  projectRoot,
  'tmp/mercedes-2024-livery/final/textures',
)
const blenderCandidatePath = process.argv[5] ?? path.join(
  projectRoot,
  'tmp/mercedes-2024-livery/final/amg-w14-2024-candidate.glb',
)

const expectedSourceSha256 = 'c70400596bb3ad3ed9babce50792c6e29fde91c98b385961630639c7eb91a5a1'
const replacementImages = [
  'mercedes_paint_matte_silver',
  'mercedes_paint_alpha__Image_9',
  'mercedes_decal_final',
  'mercedes_number_final',
  'driver_color__Image_26',
]


function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}


function parseGlb(filePath) {
  const bytes = fs.readFileSync(filePath)
  if (bytes.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${filePath} is not a GLB`)
  }
  if (bytes.readUInt32LE(4) !== 2) {
    throw new Error(`${filePath} is not glTF 2.0`)
  }

  let offset = 12
  let json = null
  let jsonText = null
  let bin = null
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset)
    const type = bytes.readUInt32LE(offset + 4)
    const payload = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) {
      jsonText = payload.toString('utf8').replace(/[ \u0000]+$/, '')
      json = JSON.parse(jsonText)
    } else if (type === 0x004e4942) {
      bin = Buffer.from(payload)
    }
    offset += 8 + length
  }

  if (!json || !jsonText || !bin) {
    throw new Error(`${filePath} must contain JSON and BIN chunks`)
  }
  return { bytes, json, jsonText, bin }
}


function padded(bytes, paddingByte) {
  const padding = (4 - (bytes.length % 4)) % 4
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, paddingByte)])
}


function writeGlb(filePath, jsonText, bin) {
  const jsonBytes = padded(Buffer.from(jsonText, 'utf8'), 0x20)
  const binBytes = padded(bin, 0x00)
  const totalLength = 12 + 8 + jsonBytes.length + 8 + binBytes.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonBytes.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binBytes.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binBytes]))
}


function skipWhitespace(text, start) {
  let cursor = start
  while (/\s/.test(text[cursor] ?? '')) cursor += 1
  return cursor
}


function jsonStringEnd(text, start) {
  if (text[start] !== '"') {
    throw new Error(`Expected JSON string at offset ${start}`)
  }
  let escaped = false
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor]
    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '"') {
      return cursor + 1
    }
  }
  throw new Error(`Unterminated JSON string at offset ${start}`)
}


function jsonValueEnd(text, start) {
  const first = text[start]
  if (first === '"') return jsonStringEnd(text, start)

  if (first === '[' || first === '{') {
    const opening = first
    const closing = opening === '[' ? ']' : '}'
    let depth = 0
    for (let cursor = start; cursor < text.length; cursor += 1) {
      const character = text[cursor]
      if (character === '"') {
        cursor = jsonStringEnd(text, cursor) - 1
      } else if (character === opening) {
        depth += 1
      } else if (character === closing) {
        depth -= 1
        if (depth === 0) return cursor + 1
      }
    }
    throw new Error(`Unterminated JSON value at offset ${start}`)
  }

  let cursor = start
  while (cursor < text.length && text[cursor] !== ',' && text[cursor] !== '}') {
    cursor += 1
  }
  return cursor
}


function topLevelJsonValueSpans(jsonText) {
  const spans = new Map()
  let cursor = skipWhitespace(jsonText, 0)
  if (jsonText[cursor] !== '{') {
    throw new Error('GLB JSON chunk must be a top-level object')
  }
  cursor += 1

  while (cursor < jsonText.length) {
    cursor = skipWhitespace(jsonText, cursor)
    if (jsonText[cursor] === '}') break
    if (jsonText[cursor] === ',') {
      cursor = skipWhitespace(jsonText, cursor + 1)
    }

    const keyStart = cursor
    const keyEnd = jsonStringEnd(jsonText, keyStart)
    const key = JSON.parse(jsonText.slice(keyStart, keyEnd))
    cursor = skipWhitespace(jsonText, keyEnd)
    if (jsonText[cursor] !== ':') {
      throw new Error(`Expected colon after top-level JSON key ${key}`)
    }
    const valueStart = skipWhitespace(jsonText, cursor + 1)
    const valueEnd = jsonValueEnd(jsonText, valueStart)
    spans.set(key, { start: valueStart, end: valueEnd })
    cursor = valueEnd
  }

  return spans
}


function spliceTopLevelJsonValues(sourceText, replacementValues) {
  const spans = topLevelJsonValueSpans(sourceText)
  const replacements = Object.entries(replacementValues).map(([key, value]) => {
    const span = spans.get(key)
    if (!span) throw new Error(`Top-level GLB JSON key not found: ${key}`)
    return { ...span, key, text: JSON.stringify(value) }
  })
  replacements.sort((left, right) => right.start - left.start)

  let output = sourceText
  for (const replacement of replacements) {
    output =
      output.slice(0, replacement.start) +
      replacement.text +
      output.slice(replacement.end)
  }
  return output
}


function rawTopLevelValue(jsonText, key) {
  const span = topLevelJsonValueSpans(jsonText).get(key)
  if (!span) throw new Error(`Top-level GLB JSON key not found: ${key}`)
  return jsonText.slice(span.start, span.end)
}


function pngDimensions(bytes) {
  const signature = '89504e470d0a1a0a'
  if (bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Replacement image is not a PNG')
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}


function geometryJsonSnapshot(json, accessorCount = json.accessors.length, ignoredMeshes = new Set()) {
  const meshesWithoutMaterials = json.meshes.map((mesh) => ({
    ...(ignoredMeshes.has(json.meshes.indexOf(mesh)) ? { name: mesh.name, ignored: true } : {
    ...mesh,
    primitives: mesh.primitives.map((primitive) => {
      const clone = { ...primitive }
      delete clone.material
      return clone
    }),
    }),
  }))
  return {
    nodes: json.nodes,
    accessors: json.accessors.slice(0, accessorCount),
    meshes: meshesWithoutMaterials,
  }
}


function appendAligned(chunks, bytes, currentLength) {
  const padding = (4 - (currentLength % 4)) % 4
  if (padding > 0) {
    chunks.push(Buffer.alloc(padding))
    currentLength += padding
  }
  const byteOffset = currentLength
  chunks.push(bytes)
  return { byteOffset, newLength: currentLength + bytes.length }
}


const ACCESSOR_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}


const COMPONENT_BYTES = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}


function readComponent(view, offset, componentType) {
  if (componentType === 5120) return view.getInt8(offset)
  if (componentType === 5121) return view.getUint8(offset)
  if (componentType === 5122) return view.getInt16(offset, true)
  if (componentType === 5123) return view.getUint16(offset, true)
  if (componentType === 5125) return view.getUint32(offset, true)
  if (componentType === 5126) return view.getFloat32(offset, true)
  throw new Error(`Unsupported accessor component type: ${componentType}`)
}


function readAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex]
  if (!accessor || accessor.bufferView === undefined || accessor.sparse) {
    throw new Error(`Unsupported accessor layout: ${accessorIndex}`)
  }
  const bufferView = json.bufferViews[accessor.bufferView]
  if (bufferView.buffer !== 0) {
    throw new Error(`Unexpected non-zero accessor buffer: ${accessorIndex}`)
  }
  const componentBytes = COMPONENT_BYTES[accessor.componentType]
  const components = ACCESSOR_COMPONENTS[accessor.type]
  if (!componentBytes || !components) {
    throw new Error(`Unsupported accessor type: ${accessorIndex}`)
  }
  const packedStride = componentBytes * components
  const stride = bufferView.byteStride ?? packedStride
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const values = new Array(accessor.count * components)
  for (let item = 0; item < accessor.count; item += 1) {
    const itemOffset = start + item * stride
    for (let component = 0; component < components; component += 1) {
      values[item * components + component] = readComponent(
        view,
        itemOffset + component * componentBytes,
        accessor.componentType,
      )
    }
  }
  return { accessor, components, values }
}


function encodeIndices(values, componentType) {
  const componentBytes = COMPONENT_BYTES[componentType]
  if (![5121, 5123, 5125].includes(componentType)) {
    throw new Error(`Unsupported index component type: ${componentType}`)
  }
  const bytes = Buffer.alloc(values.length * componentBytes)
  values.forEach((value, index) => {
    const offset = index * componentBytes
    if (componentType === 5121) bytes.writeUInt8(value, offset)
    if (componentType === 5123) bytes.writeUInt16LE(value, offset)
    if (componentType === 5125) bytes.writeUInt32LE(value, offset)
  })
  return bytes
}


function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  return length > 0 ? vector.map((value) => value / length) : [0, 0, 0]
}


function isCockpitSilverTriangle(centerGltf, normalGltf) {
  // Blender's glTF import converts (x, y, z) to (x, -z, y), then applies the
  // W14 collection's uniform scale and translation. The source hash above
  // locks these constants to the audited asset.
  const scale = 1.0000050067901611
  const worldCenter = [
    centerGltf[0] * scale,
    -centerGltf[2] * scale - 0.2692401707172394,
    centerGltf[1] * scale + 0.4664706289768219,
  ]
  const worldNormal = normalize3([normalGltf[0], -normalGltf[2], normalGltf[1]])
  const absoluteX = Math.abs(worldCenter[0])
  const spear =
    worldCenter[1] >= -1.90 &&
    worldCenter[1] <= -0.82 &&
    absoluteX <= 0.19 &&
    worldCenter[2] >= 0.60 &&
    worldNormal[2] >= 0.18
  const cockpitRails =
    worldCenter[1] >= -1.34 &&
    worldCenter[1] <= -0.30 &&
    absoluteX >= 0.075 &&
    absoluteX <= 0.50 &&
    worldCenter[2] >= 0.675 &&
    worldNormal[2] >= 0.12
  return spear || cockpitRails
}


function splitCockpitIndices(json, bin, primitive) {
  const positions = readAccessor(json, bin, primitive.attributes.POSITION)
  const normals = readAccessor(json, bin, primitive.attributes.NORMAL)
  const indices = readAccessor(json, bin, primitive.indices)
  if (positions.components !== 3 || normals.components !== 3 || indices.components !== 1) {
    throw new Error('Unexpected cockpit primitive accessor shape')
  }
  if (indices.values.length % 3 !== 0) {
    throw new Error('Cockpit primitive must contain triangle indices')
  }

  const baseIndices = []
  const silverIndices = []
  const triangles = []
  for (let offset = 0; offset < indices.values.length; offset += 3) {
    const triangle = indices.values.slice(offset, offset + 3)
    const center = [0, 0, 0]
    triangle.forEach((vertexIndex) => {
      for (let axis = 0; axis < 3; axis += 1) {
        center[axis] += positions.values[vertexIndex * 3 + axis] / 3
      }
    })
    const points = triangle.map((vertexIndex) =>
      positions.values.slice(vertexIndex * 3, vertexIndex * 3 + 3),
    )
    const edgeA = points[1].map((value, axis) => value - points[0][axis])
    const edgeB = points[2].map((value, axis) => value - points[0][axis])
    const normal = [
      edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
      edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
      edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
    ]
    triangles.push({
      indices: triangle,
      seed: isCockpitSilverTriangle(center, normal),
    })
  }

  const vertexTriangles = new Map()
  triangles.forEach((triangle, triangleIndex) => {
    triangle.indices.forEach((vertexIndex) => {
      const neighbors = vertexTriangles.get(vertexIndex) ?? []
      neighbors.push(triangleIndex)
      vertexTriangles.set(vertexIndex, neighbors)
    })
  })

  const visited = new Set()
  let silverTriangles = 0
  let silverComponents = 0
  triangles.forEach((triangle, triangleIndex) => {
    if (visited.has(triangleIndex)) return
    const pending = [triangleIndex]
    const component = []
    visited.add(triangleIndex)
    while (pending.length > 0) {
      const currentIndex = pending.pop()
      component.push(currentIndex)
      triangles[currentIndex].indices.forEach((vertexIndex) => {
        for (const neighborIndex of vertexTriangles.get(vertexIndex) ?? []) {
          if (!visited.has(neighborIndex)) {
            visited.add(neighborIndex)
            pending.push(neighborIndex)
          }
        }
      })
    }

    const useSilver = component.some((index) => triangles[index].seed)
    if (useSilver) silverComponents += 1
    for (const index of component) {
      if (useSilver) {
        silverIndices.push(...triangles[index].indices)
        silverTriangles += 1
      } else {
        baseIndices.push(...triangles[index].indices)
      }
    }
  })
  return {
    baseIndices,
    silverIndices,
    silverTriangles,
    silverComponents,
    baseTriangles: baseIndices.length / 3,
    totalTriangles: indices.values.length / 3,
    sourceAccessor: indices.accessor,
    sourceIndices: indices.values,
  }
}


function appendIndexAccessor(json, chunks, values, sourceAccessor, currentLength) {
  if (values.length === 0) throw new Error('Cannot append an empty index accessor')
  const bytes = encodeIndices(values, sourceAccessor.componentType)
  const appended = appendAligned(chunks, bytes, currentLength)
  const bufferViewIndex = json.bufferViews.length
  json.bufferViews.push({
    buffer: 0,
    byteOffset: appended.byteOffset,
    byteLength: bytes.length,
    target: 34963,
  })
  const accessorIndex = json.accessors.length
  const accessor = {
    ...sourceAccessor,
    bufferView: bufferViewIndex,
    byteOffset: 0,
    count: values.length,
    min: [Math.min(...values)],
    max: [Math.max(...values)],
  }
  json.accessors.push(accessor)
  return {
    accessorIndex,
    bufferViewIndex,
    bytes: bytes.length,
    newLength: appended.newLength,
  }
}


const source = parseGlb(sourcePath)
const sourceHash = sha256(source.bytes)
if (sourceHash !== expectedSourceSha256) {
  throw new Error(
    `Source GLB changed concurrently: expected ${expectedSourceSha256}, got ${sourceHash}`,
  )
}

const blenderCandidate = parseGlb(blenderCandidatePath)
const json = structuredClone(source.json)
const originalBufferViewCount = source.json.bufferViews.length
const originalAccessorCount = source.json.accessors.length
const cockpitNode = source.json.nodes.find((node) => node.name === 'Object_386')
const spineNode = source.json.nodes.find((node) => node.name === 'Object_66')
const numberSubstrateNode = source.json.nodes.find((node) => node.name === 'Object_388')
if (
  cockpitNode?.mesh === undefined ||
  spineNode?.mesh === undefined ||
  numberSubstrateNode?.mesh === undefined
) {
  throw new Error('Cockpit color-partition nodes are missing from the source GLB')
}
const cockpitMeshIndex = cockpitNode.mesh
const spineMeshIndex = spineNode.mesh
const numberSubstrateMeshIndex = numberSubstrateNode.mesh
const ignoredPartitionMeshes = new Set([cockpitMeshIndex])
const originalGeometryJsonHash = sha256(
  Buffer.from(
    JSON.stringify(
      geometryJsonSnapshot(source.json, originalAccessorCount, ignoredPartitionMeshes),
    ),
  ),
)
const originalRawNodesHash = sha256(
  Buffer.from(rawTopLevelValue(source.jsonText, 'nodes')),
)
const originalAccessorsHash = sha256(
  Buffer.from(JSON.stringify(source.json.accessors)),
)

const appendedChunks = [source.bin]
let binLength = source.bin.length
const replaced = []

for (const imageName of replacementImages) {
  const imageIndex = json.images.findIndex((image) => image.name === imageName)
  if (imageIndex < 0) {
    throw new Error(`Image not found in source GLB: ${imageName}`)
  }
  const image = json.images[imageIndex]
  const oldBufferViewIndex = image.bufferView
  const bufferView = json.bufferViews[oldBufferViewIndex]
  if (bufferView.buffer !== 0) {
    throw new Error(`Unexpected non-zero image buffer for ${imageName}`)
  }

  const candidateImage = blenderCandidate.json.images.find(
    (candidate) => candidate.name === imageName,
  )
  if (!candidateImage || candidateImage.bufferView === undefined) {
    throw new Error(`Replacement image missing from Blender candidate: ${imageName}`)
  }
  const candidateView = blenderCandidate.json.bufferViews[candidateImage.bufferView]
  if (candidateView.buffer !== 0) {
    throw new Error(`Unexpected candidate image buffer for ${imageName}`)
  }
  const candidateOffset = candidateView.byteOffset ?? 0
  const replacement = Buffer.from(
    blenderCandidate.bin.subarray(candidateOffset, candidateOffset + candidateView.byteLength),
  )
  const replacementPath = path.join(textureDir, `${imageName}.png`)
  fs.mkdirSync(textureDir, { recursive: true })
  fs.writeFileSync(replacementPath, replacement)
  const dimensions = pngDimensions(replacement)
  const appended = appendAligned(appendedChunks, replacement, binLength)
  binLength = appended.newLength
  const newBufferViewIndex = json.bufferViews.length
  json.bufferViews.push({
    buffer: 0,
    byteOffset: appended.byteOffset,
    byteLength: replacement.length,
  })
  image.bufferView = newBufferViewIndex
  replaced.push({
    imageName,
    replacementPath,
    dimensions,
    bytes: replacement.length,
    sha256: sha256(replacement),
    oldBufferView: oldBufferViewIndex,
    newBufferView: newBufferViewIndex,
    byteOffset: appended.byteOffset,
  })
}

const candidateNose = blenderCandidate.json.materials.find(
  (material) => material.name === 'mercedes_paint_nose',
)
const sourceNoseIndex = json.materials.findIndex(
  (material) => material.name === 'mercedes_paint_nose',
)
if (!candidateNose || sourceNoseIndex < 0) {
  throw new Error('Nose material missing from source or Blender candidate')
}
json.materials[sourceNoseIndex] = structuredClone(candidateNose)

const cyanMaterial = blenderCandidate.json.materials.find(
  (material) => material.name === 'mercedes_paint_2024_cyan',
)
if (!cyanMaterial) {
  throw new Error('Blender candidate is missing mercedes_paint_2024_cyan')
}
const cyanMaterialIndex = json.materials.length
json.materials.push(structuredClone(cyanMaterial))

const cockpitSilverMaterial = blenderCandidate.json.materials.find(
  (material) => material.name === 'mercedes_paint_2024_cockpit_silver',
)
if (!cockpitSilverMaterial) {
  throw new Error('Blender candidate is missing mercedes_paint_2024_cockpit_silver')
}
const cockpitSilverMaterialIndex = json.materials.length
json.materials.push(structuredClone(cockpitSilverMaterial))

json.extensionsUsed ??= []
for (const material of [cyanMaterial, cockpitSilverMaterial]) {
  for (const extensionName of Object.keys(material.extensions ?? {})) {
    if (!json.extensionsUsed.includes(extensionName)) {
      json.extensionsUsed.push(extensionName)
    }
  }
}
json.extensionsUsed.sort()

const mirrorAssignments = []
for (const { nodeName, sourceMaterial } of [
  { nodeName: 'Object_149', sourceMaterial: 'mercedes_paint' },
  { nodeName: 'Object_160', sourceMaterial: 'mercedes_paint' },
  { nodeName: 'Object_153', sourceMaterial: 'mercedes_carbon1' },
  { nodeName: 'Object_164', sourceMaterial: 'mercedes_carbon1' },
]) {
  const node = json.nodes.find((candidate) => candidate.name === nodeName)
  if (!node || node.mesh === undefined) {
    throw new Error(`Mirror mesh node missing: ${nodeName}`)
  }
  const mesh = json.meshes[node.mesh]
  if (mesh.primitives.length !== 1) {
    throw new Error(`Unexpected mirror primitive count: ${nodeName}`)
  }
  const oldMaterial = mesh.primitives[0].material
  if (json.materials[oldMaterial]?.name !== sourceMaterial) {
    throw new Error(`Unexpected source mirror material: ${nodeName}`)
  }
  mesh.primitives[0].material = cyanMaterialIndex
  mirrorAssignments.push({ nodeName, mesh: node.mesh, oldMaterial, newMaterial: cyanMaterialIndex })
}

const cockpitWholeObjectAssignments = []
for (const { nodeName, meshIndex } of [
  { nodeName: 'Object_66', meshIndex: spineMeshIndex },
  { nodeName: 'Object_388', meshIndex: numberSubstrateMeshIndex },
]) {
  const mesh = json.meshes[meshIndex]
  if (mesh.primitives.length !== 1) {
    throw new Error(`Unexpected cockpit paint primitive count: ${nodeName}`)
  }
  const oldMaterial = mesh.primitives[0].material
  if (json.materials[oldMaterial]?.name !== 'mercedes_paint') {
    throw new Error(`Unexpected cockpit paint source material: ${nodeName}`)
  }
  mesh.primitives[0].material = cockpitSilverMaterialIndex
  cockpitWholeObjectAssignments.push({
    nodeName,
    mesh: meshIndex,
    oldMaterial,
    newMaterial: cockpitSilverMaterialIndex,
  })
}

const cockpitMesh = json.meshes[cockpitMeshIndex]
if (cockpitMesh.primitives.length !== 1) {
  throw new Error('Unexpected upper-monocoque primitive count')
}
const cockpitSourcePrimitive = cockpitMesh.primitives[0]
if (json.materials[cockpitSourcePrimitive.material]?.name !== 'mercedes_paint') {
  throw new Error('Unexpected upper-monocoque source material')
}
const cockpitPartition = splitCockpitIndices(source.json, source.bin, cockpitSourcePrimitive)
if (
  cockpitPartition.silverTriangles !== 7071 ||
  cockpitPartition.silverComponents !== 48
) {
  throw new Error(
    `Cockpit selection drifted: expected 7071 faces in 48 components, got ` +
      `${cockpitPartition.silverTriangles} faces in ${cockpitPartition.silverComponents} components`,
  )
}
const baseIndexAppend = appendIndexAccessor(
  json,
  appendedChunks,
  cockpitPartition.baseIndices,
  cockpitPartition.sourceAccessor,
  binLength,
)
binLength = baseIndexAppend.newLength
const silverIndexAppend = appendIndexAccessor(
  json,
  appendedChunks,
  cockpitPartition.silverIndices,
  cockpitPartition.sourceAccessor,
  binLength,
)
binLength = silverIndexAppend.newLength

const basePrimitive = structuredClone(cockpitSourcePrimitive)
basePrimitive.indices = baseIndexAppend.accessorIndex
const silverPrimitive = structuredClone(cockpitSourcePrimitive)
silverPrimitive.indices = silverIndexAppend.accessorIndex
silverPrimitive.material = cockpitSilverMaterialIndex
cockpitMesh.primitives = [basePrimitive, silverPrimitive]

const finalPadding = (4 - (binLength % 4)) % 4
if (finalPadding > 0) {
  appendedChunks.push(Buffer.alloc(finalPadding))
  binLength += finalPadding
}
const finalBin = Buffer.concat(appendedChunks)
if (finalBin.length !== binLength) {
  throw new Error('Internal BIN length accounting mismatch')
}
json.buffers[0].byteLength = finalBin.length
const outputJsonText = spliceTopLevelJsonValues(source.jsonText, {
  extensionsUsed: json.extensionsUsed,
  materials: json.materials,
  meshes: json.meshes,
  images: json.images,
  bufferViews: json.bufferViews,
  accessors: json.accessors,
  buffers: json.buffers,
})
writeGlb(outputPath, outputJsonText, finalBin)

const output = parseGlb(outputPath)
const outputGeometryJsonHash = sha256(
  Buffer.from(
    JSON.stringify(
      geometryJsonSnapshot(output.json, originalAccessorCount, ignoredPartitionMeshes),
    ),
  ),
)
if (outputGeometryJsonHash !== originalGeometryJsonHash) {
  throw new Error('Preserved geometry JSON changed during livery-only GLB patch')
}
const outputRawNodesHash = sha256(
  Buffer.from(rawTopLevelValue(output.jsonText, 'nodes')),
)
const outputAccessorsHash = sha256(
  Buffer.from(JSON.stringify(output.json.accessors.slice(0, originalAccessorCount))),
)
if (outputRawNodesHash !== originalRawNodesHash) {
  throw new Error('Raw nodes JSON changed during livery-only GLB patch')
}
if (outputAccessorsHash !== originalAccessorsHash) {
  throw new Error('An original accessor changed during livery-only GLB patch')
}
if (
  JSON.stringify(output.json.bufferViews.slice(0, originalBufferViewCount)) !==
  JSON.stringify(source.json.bufferViews)
) {
  throw new Error('An original bufferView changed during livery-only GLB patch')
}
const preservedOriginalBinHash = sha256(output.bin.subarray(0, source.bin.length))
const originalBinHash = sha256(source.bin)
if (preservedOriginalBinHash !== originalBinHash) {
  throw new Error('Original geometry/image BIN prefix changed during patch')
}

const outputCockpitMesh = output.json.meshes[cockpitMeshIndex]
if (outputCockpitMesh.primitives.length !== 2) {
  throw new Error('Cockpit material partition was not written as two primitives')
}
const outputBaseIndices = readAccessor(
  output.json,
  output.bin,
  outputCockpitMesh.primitives[0].indices,
).values
const outputSilverIndices = readAccessor(
  output.json,
  output.bin,
  outputCockpitMesh.primitives[1].indices,
).values
if (
  JSON.stringify(outputBaseIndices) !== JSON.stringify(cockpitPartition.baseIndices) ||
  JSON.stringify(outputSilverIndices) !== JSON.stringify(cockpitPartition.silverIndices)
) {
  throw new Error('Cockpit triangle partition changed while writing the GLB')
}
if (
  outputBaseIndices.length + outputSilverIndices.length !==
  cockpitPartition.sourceIndices.length
) {
  throw new Error('Cockpit material partition lost or duplicated triangle indices')
}

const report = {
  sourcePath,
  sourceSha256: sourceHash,
  outputPath,
  outputSha256: sha256(output.bytes),
  outputBytes: output.bytes.length,
  originalBinBytes: source.bin.length,
  outputBinBytes: output.bin.length,
  originalBinSha256: originalBinHash,
  preservedOriginalBinSha256: preservedOriginalBinHash,
  geometryJsonSha256: originalGeometryJsonHash,
  rawNodesSha256: originalRawNodesHash,
  outputRawNodesSha256: outputRawNodesHash,
  originalAccessorsSha256: originalAccessorsHash,
  outputOriginalAccessorsSha256: outputAccessorsHash,
  originalAccessorsPreserved: originalAccessorCount,
  originalBufferViewsPreserved: originalBufferViewCount,
  appendedBufferViews: output.json.bufferViews.length - originalBufferViewCount,
  replaced,
  materialsBefore: source.json.materials.length,
  materialsAfter: output.json.materials.length,
  cyanMaterialIndex,
  cockpitSilverMaterialIndex,
  mirrorAssignments,
  cockpitWholeObjectAssignments,
  cockpitPartition: {
    nodeName: 'Object_386',
    mesh: cockpitMeshIndex,
    totalTriangles: cockpitPartition.totalTriangles,
    baseTriangles: cockpitPartition.baseTriangles,
    silverTriangles: cockpitPartition.silverTriangles,
    silverComponents: cockpitPartition.silverComponents,
    baseIndexAccessor: baseIndexAppend.accessorIndex,
    silverIndexAccessor: silverIndexAppend.accessorIndex,
    indexComponentType: cockpitPartition.sourceAccessor.componentType,
  },
  nodeCount: output.json.nodes.length,
  meshCount: output.json.meshes.length,
  accessorCount: output.json.accessors.length,
  imageCount: output.json.images.length,
}

console.log(JSON.stringify(report, null, 2))
