import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  AdaptiveDpr,
  Environment,
  MeshTransmissionMaterial,
  Text,
  useGLTF,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import styles from './HeroGlassPage.module.css'
import {
  HERO_PENCIL_REVEAL_DURATION_MS,
  HERO_PENCIL_STROKE_WIDTH,
  HERO_PENCIL_STROKES,
  HERO_PENCIL_TIMING_SCALE,
  HERO_PENCIL_TITLE_ADVANCE,
  HERO_PENCIL_TITLE_BASELINE,
} from './heroPencilTitle'

const SCRIBBLE_FONT_URL = '/fonts/ScribbleFont-Regular.otf'
const HELMET_MODEL_URL = '/media/helmet/russell-glass-shell.glb?v=shiny-black-visor-v3'
const HERO_TITLE_POSITION: [number, number, number] = [0, 0.04, 1.2]

type HeroTitleLayout = {
  baselineY: number
  fontSize: number
  viewportHeight: number
  viewportWidth: number
}

type PencilStrokeStyle = CSSProperties & {
  '--pencil-delay': string
  '--pencil-duration': string
  '--pencil-length': string
}

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

function HeroTitle({
  finalVisible,
  onLayout,
  onReady,
}: {
  finalVisible: boolean
  onLayout: (layout: HeroTitleLayout) => void
  onReady: () => void
}) {
  const viewportWidth = useThree((state) => state.viewport.width)
  const viewport = useThree((state) => state.viewport)
  const camera = useThree((state) => state.camera)
  const fontSize = Math.min(1.42, viewportWidth / 5.4) * 0.7
  const handleSync = useCallback(
    (troika: { textRenderInfo?: { topBaseline?: number } }) => {
      const topBaseline = troika.textRenderInfo?.topBaseline

      if (typeof topBaseline === 'number') {
        const titleViewport = viewport.getCurrentViewport(
          camera,
          HERO_TITLE_POSITION,
        )
        onLayout({
          baselineY: HERO_TITLE_POSITION[1] + topBaseline,
          fontSize,
          viewportHeight: titleViewport.height,
          viewportWidth: titleViewport.width,
        })
      }

      onReady()
    },
    [camera, fontSize, onLayout, onReady, viewport],
  )

  return (
    <Text
      anchorX="center"
      anchorY="middle"
      color="#f1efe9"
      font={SCRIBBLE_FONT_URL}
      fontSize={fontSize}
      letterSpacing={-0.035}
      onSync={handleSync}
      position={HERO_TITLE_POSITION}
      visible={finalVisible}
    >
      The Onboard
    </Text>
  )
}

function HeroPencilReveal({
  isComplete,
  layout,
}: {
  isComplete: boolean
  layout: HeroTitleLayout
}) {
  const scale = layout.fontSize / 1000
  const titleTransform = [
    `translate(${-HERO_PENCIL_TITLE_ADVANCE * scale / 2}`,
    `${-layout.baselineY - HERO_PENCIL_TITLE_BASELINE * scale})`,
    `scale(${scale})`,
  ].join(' ')
  const viewBox = [
    -layout.viewportWidth / 2,
    -layout.viewportHeight / 2,
    layout.viewportWidth,
    layout.viewportHeight,
  ].join(' ')

  return (
    <div
      aria-hidden="true"
      className={
        isComplete
          ? `${styles.titleReveal} ${styles.titleRevealComplete}`
          : styles.titleReveal
      }
    >
      <svg preserveAspectRatio="none" viewBox={viewBox}>
        <g transform={titleTransform}>
          {HERO_PENCIL_STROKES.map((stroke, index) => (
            <path
              className={styles.pencilStroke}
              d={stroke.d}
              fill="none"
              key={index}
              stroke="#f1efe9"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={HERO_PENCIL_STROKE_WIDTH}
              style={
                {
                  '--pencil-delay': `${stroke.delay * HERO_PENCIL_TIMING_SCALE}ms`,
                  '--pencil-duration': `${stroke.duration * HERO_PENCIL_TIMING_SCALE}ms`,
                  '--pencil-length': `${stroke.length}px`,
                } as PencilStrokeStyle
              }
            />
          ))}
        </g>
      </svg>
    </div>
  )
}

function isGlassRole(role: HelmetPartRole): boolean {
  return role === 'shell'
}

function HelmetMaterial({ role }: { role: HelmetPartRole }) {
  if (role === 'shell') {
    return (
      <MeshTransmissionMaterial
        anisotropicBlur={0}
        attenuationColor="#9fd0e2"
        attenuationDistance={5}
        chromaticAberration={0}
        clearcoat={0.14}
        clearcoatRoughness={0.16}
        color="#d5e2e6"
        distortion={0}
        envMapIntensity={0.58}
        ior={1.3}
        metalness={0}
        resolution={768}
        roughness={0.025}
        samples={6}
        thickness={0.025}
        temporalDistortion={0}
        transmission={0.94}
      />
    )
  }

  if (role === 'visor') {
    // Opaque smoked polycarbonate: black with one restrained, broad highlight.
    return (
      <meshPhysicalMaterial
        clearcoat={0.72}
        clearcoatRoughness={0.12}
        color="#010204"
        envMapIntensity={0.32}
        ior={1.52}
        metalness={0}
        roughness={0.14}
        side={THREE.FrontSide}
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
      helmetRef.current.rotation.y += delta * 0.1399205
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

function HeroScene({
  finalTitleVisible,
  onTitleLayout,
  onTitleReady,
}: {
  finalTitleVisible: boolean
  onTitleLayout: (layout: HeroTitleLayout) => void
  onTitleReady: () => void
}) {
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
      <Environment background={false} frames={1} preset="apartment" />
      <HeroTitle
        finalVisible={finalTitleVisible}
        onLayout={onTitleLayout}
        onReady={onTitleReady}
      />
      <GlassHelmet />
    </>
  )
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}

// Open this isolated landing prototype at /hero.
export default function HeroGlassPage() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [titleLayout, setTitleLayout] = useState<HeroTitleLayout | null>(null)
  const [titleReady, setTitleReady] = useState(false)
  const [introState, setIntroState] = useState<'waiting' | 'drawing' | 'complete'>(
    'waiting',
  )
  const handleTitleLayout = useCallback((layout: HeroTitleLayout) => {
    setTitleLayout((currentLayout) => {
      if (
        currentLayout &&
        Math.abs(currentLayout.baselineY - layout.baselineY) < 0.0001 &&
        Math.abs(currentLayout.fontSize - layout.fontSize) < 0.0001 &&
        Math.abs(currentLayout.viewportHeight - layout.viewportHeight) < 0.0001 &&
        Math.abs(currentLayout.viewportWidth - layout.viewportWidth) < 0.0001
      ) {
        return currentLayout
      }

      return layout
    })
  }, [])
  const handleTitleReady = useCallback(() => setTitleReady(true), [])

  useEffect(() => {
    if (!titleReady) return

    if (prefersReducedMotion) {
      setIntroState('complete')
      return
    }

    if (titleLayout) {
      setIntroState((currentState) =>
        currentState === 'waiting' ? 'drawing' : currentState,
      )
    }
  }, [prefersReducedMotion, titleLayout, titleReady])

  useEffect(() => {
    if (introState !== 'drawing') return

    const timeoutId = window.setTimeout(
      () => setIntroState('complete'),
      HERO_PENCIL_REVEAL_DURATION_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [introState])

  return (
    <main className={styles.page}>
      <Canvas
        className={styles.canvas}
        camera={{ fov: 34, position: [0, 0, 7.4] }}
        dpr={[1, 1.25]}
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 0.88
        }}
        performance={{ min: 0.5 }}
      >
        <Suspense fallback={null}>
          <AdaptiveDpr />
          <HeroScene
            finalTitleVisible={false}
            onTitleLayout={handleTitleLayout}
            onTitleReady={handleTitleReady}
          />
        </Suspense>
      </Canvas>

      {introState !== 'waiting' && titleLayout ? (
        <HeroPencilReveal
          isComplete={introState === 'complete'}
          layout={titleLayout}
        />
      ) : null}

      <nav className={styles.nav} aria-label="Prototype navigation">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <a href="/replay">Replay</a>
      </nav>
    </main>
  )
}

useGLTF.preload(HELMET_MODEL_URL)
