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
const HELMET_MODEL_URL = '/media/helmet/russell-glass-shell.glb'

type HelmetPartRole = 'shell' | 'visor' | 'aeroClear' | 'trim'

interface HelmetPart {
  geometry: THREE.BufferGeometry
  key: string
  matrix: THREE.Matrix4
  role: HelmetPartRole
}

function getHelmetPartRole(name: string): HelmetPartRole | null {
  const normalizedName = name.toLowerCase().replace(/[^a-z]/g, '')

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
  const fontSize = Math.min(1.42, viewportWidth / 5.4)

  return (
    <Text
      anchorX="center"
      anchorY="middle"
      color="#f1efe9"
      font={SCRIBBLE_FONT_URL}
      fontSize={fontSize}
      letterSpacing={-0.035}
      position={[0, 0.04, -2.45]}
    >
      The Onboard
    </Text>
  )
}

function HelmetMaterial({ role }: { role: HelmetPartRole }) {
  if (role === 'shell') {
    return (
      <MeshTransmissionMaterial
        anisotropicBlur={0.01}
        attenuationColor="#00b4e4"
        attenuationDistance={1.6}
        backside
        backsideThickness={0.18}
        chromaticAberration={0}
        clearcoat={0.5}
        clearcoatRoughness={0.2}
        color="#718b92"
        distortion={0}
        ior={1.4}
        resolution={512}
        roughness={0.16}
        samples={6}
        thickness={0.46}
        temporalDistortion={0}
        transmission={0.76}
      />
    )
  }

  if (role === 'visor') {
    return (
      <meshPhysicalMaterial
        clearcoat={1}
        clearcoatRoughness={0.08}
        color="#050b0e"
        envMapIntensity={2.4}
        ior={1.45}
        metalness={0.32}
        opacity={0.9}
        roughness={0.1}
        side={THREE.DoubleSide}
        thickness={0.16}
        transparent
        transmission={0.14}
      />
    )
  }

  if (role === 'aeroClear') {
    return (
      <MeshTransmissionMaterial
        attenuationColor="#b9edfa"
        attenuationDistance={6}
        backside
        backsideThickness={0.04}
        chromaticAberration={0}
        clearcoat={0.35}
        clearcoatRoughness={0.12}
        color="#ddf7fb"
        distortion={0}
        ior={1.33}
        resolution={512}
        roughness={0.08}
        samples={4}
        thickness={0.08}
        temporalDistortion={0}
        transmission={0.94}
      />
    )
  }

  return (
    <meshStandardMaterial
      color="#11181b"
      envMapIntensity={1.8}
      metalness={0.72}
      roughness={0.26}
      side={THREE.DoubleSide}
    />
  )
}

function GlassHelmet() {
  const helmetRef = useRef<THREE.Group>(null)
  const viewport = useThree((state) => state.viewport)
  const { scene } = useGLTF(HELMET_MODEL_URL)
  const helmetParts = useMemo(
    () => collectHelmetParts(scene.clone(true)),
    [scene],
  )
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
      position={[0, -0.08, 0.4]}
      rotation={[0, -Math.PI / 12, 0]}
      scale={helmetScale}
    >
      {helmetParts.map((part) => (
        <mesh
          geometry={part.geometry}
          key={part.key}
          matrix={part.matrix}
          matrixAutoUpdate={false}
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
      <directionalLight
        color="#dce7ec"
        intensity={4.2}
        position={[4.5, 5.5, 6]}
      />
      <Environment background={false} preset="city" />
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
        dpr={[1, 1.75]}
        gl={{ alpha: false, antialias: true }}
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
