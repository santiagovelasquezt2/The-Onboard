import { Suspense, useMemo, useRef } from 'react'
import {
  Environment,
  MeshTransmissionMaterial,
  Text,
  useGLTF,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import styles from './HeroGlassPage.module.css'

const SCRIBBLE_FONT_URL = '/fonts/ScribbleFont-Regular.otf'
const HELMET_MODEL_URL = '/media/helmet/russell-glass-shell.glb?v=aero-quiet-visor-clean-v2'

type HelmetPartRole = 'shell' | 'visor' | 'aeroClear' | 'trim' | 'detail' | 'number'

interface HelmetPart {
  geometry: THREE.BufferGeometry
  key: string
  matrix: THREE.Matrix4
  role: HelmetPartRole
}

function getHelmetPartRole(name: string): HelmetPartRole | null {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '')

  if (
    normalizedName.includes('helmetshell') ||
    normalizedName.includes('glassshell')
  ) {
    return 'shell'
  }

  if (normalizedName.includes('visor')) {
    return 'visor'
  }

  if (normalizedName.includes('aeroclear')) {
    return 'aeroClear'
  }

  if (normalizedName.includes('number63') || normalizedName.includes('number')) {
    return 'number'
  }

  if (normalizedName.includes('detail')) {
    return 'detail'
  }

  if (normalizedName.includes('trim')) {
    return 'trim'
  }

  return null
}

function collectHelmetParts(root: THREE.Object3D): HelmetPart[] {
  const parts: HelmetPart[] = []

  root.updateMatrixWorld(true)

  function visit(object: THREE.Object3D, inheritedRole: HelmetPartRole | null) {
    const role = getHelmetPartRole(object.name) ?? inheritedRole

    if (role && object instanceof THREE.Mesh) {
      parts.push({
        geometry: object.geometry,
        key: `${role}-${object.uuid}`,
        matrix: object.matrixWorld.clone(),
        role,
      })
    }

    object.children.forEach((child) => visit(child, role))
  }

  visit(root, null)

  return parts
}

function HeroTitle() {
  const viewportWidth = useThree((state) => state.viewport.width)
  const fontSize = Math.min(1.42, viewportWidth / 5.4) * 0.7

  return (
    <Text
      anchorX="center"
      anchorY="middle"
      color="#f1efe9"
      font={SCRIBBLE_FONT_URL}
      fontSize={fontSize}
      letterSpacing={-0.035}
      position={[0, 0.04, 1.2]}
    >
      The Onboard
    </Text>
  )
}

function isGlassRole(role: HelmetPartRole): boolean {
  return role === 'shell' || role === 'visor'
}

function HelmetMaterial({ role }: { role: HelmetPartRole }) {
  if (role === 'shell') {
    return (
      <MeshTransmissionMaterial
        anisotropicBlur={0.28}
        attenuationColor="#9fd0e2"
        attenuationDistance={5}
        chromaticAberration={0}
        clearcoat={0.14}
        clearcoatRoughness={0.26}
        color="#d5e2e6"
        distortion={0}
        envMapIntensity={0.58}
        ior={1.3}
        metalness={0}
        roughness={0.14}
        samples={8}
        thickness={0.14}
        temporalDistortion={0}
        transmission={0.94}
      />
    )
  }

  if (role === 'visor') {
    return (
      <meshPhysicalMaterial
        attenuationColor="#5a7a88"
        attenuationDistance={3.8}
        clearcoat={0.05}
        clearcoatRoughness={0.42}
        color="#8fa4ae"
        envMapIntensity={0.28}
        ior={1.34}
        metalness={0}
        roughness={0.3}
        side={THREE.FrontSide}
        thickness={0.1}
        transmission={0.72}
      />
    )
  }

  if (role === 'aeroClear') {
    return (
      <meshStandardMaterial
        color="#12181b"
        envMapIntensity={0.55}
        metalness={0.55}
        roughness={0.42}
        side={THREE.FrontSide}
      />
    )
  }

  if (role === 'number') {
    return (
      <meshPhysicalMaterial
        clearcoat={0.12}
        clearcoatRoughness={0.4}
        color="#333a3d"
        envMapIntensity={0.45}
        metalness={0.04}
        roughness={0.48}
        side={THREE.DoubleSide}
      />
    )
  }

  return (
    <meshStandardMaterial
      color="#0e1417"
      envMapIntensity={0.7}
      metalness={0.65}
      roughness={0.36}
      side={THREE.DoubleSide}
    />
  )
}

function GlassHelmet() {
  const helmetRef = useRef<THREE.Group>(null)
  const viewport = useThree((state) => state.viewport)
  const { scene } = useGLTF(HELMET_MODEL_URL)
  const helmetParts = useMemo(() => {
    const parts = collectHelmetParts(scene.clone(true))
    for (const part of parts) {
      if (!part.geometry.getAttribute('normal')) {
        part.geometry.computeVertexNormals()
      }
    }
    return parts
  }, [scene])
  const helmetScale =
    1.32 *
    0.75 *
    Math.min(1, viewport.width / 3.55, viewport.height / 4.15)

  useFrame((_, delta) => {
    if (helmetRef.current) {
      helmetRef.current.rotation.y += delta * 0.08
    }
  })

  return (
    <group
      dispose={null}
      ref={helmetRef}
      position={[0, 1.35, -1.4]}
      rotation={[0, -Math.PI / 12, 0]}
      scale={helmetScale}
    >
      {helmetParts.map((part) => (
        <mesh
          castShadow={false}
          frustumCulled={false}
          geometry={part.geometry}
          key={part.key}
          matrix={part.matrix}
          matrixAutoUpdate={false}
          receiveShadow={false}
          renderOrder={isGlassRole(part.role) ? 2 : 0}
        >
          <HelmetMaterial role={part.role} />
        </mesh>
      ))}
    </group>
  )
}

function HeroScene() {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={0.26} />
      <directionalLight
        color="#f2f7fa"
        intensity={1.35}
        position={[4.5, 5.5, 6]}
      />
      <directionalLight
        color="#9eb8c8"
        intensity={0.7}
        position={[-5, 2.5, -3]}
      />
      <Environment background={false} preset="apartment" />
      <HeroTitle />
      <GlassHelmet />
    </>
  )
}

// Open this isolated landing prototype at /hero.
export default function HeroGlassPage() {
  return (
    <main className={styles.page}>
      <Canvas
        className={styles.canvas}
        camera={{ fov: 34, position: [0, 0, 7.4] }}
        dpr={[1, 2]}
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 0.88
        }}
      >
        <Suspense fallback={null}>
          <HeroScene />
        </Suspense>
      </Canvas>

      <nav className={styles.nav} aria-label="Prototype navigation">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <a href="/replay">Replay</a>
      </nav>
    </main>
  )
}

useGLTF.preload(HELMET_MODEL_URL)
