import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import apartmentEnvironmentUrl from '@pmndrs/assets/hdri/apartment.exr'
import {
  AdaptiveDpr,
  Environment,
  MeshTransmissionMaterial,
  useGLTF,
} from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RUNTIME_ASSETS } from '../../runtimeAssets'
import { Icon } from '../../ui/Icon'
import { ReliableCanvas, WebGLFallback } from '../../ui/WebGLFallback'
import styles from './HeroPage.module.css'
import {
  HERO_PENCIL_REVEAL_DURATION_MS,
  HERO_PENCIL_STROKE_WIDTH,
  HERO_PENCIL_STROKES,
  HERO_PENCIL_TIMING_SCALE,
  HERO_PENCIL_TITLE_ADVANCE,
  HERO_PENCIL_TITLE_BASELINE,
} from './pencilTitle'

const HELMET_MODEL_URL = RUNTIME_ASSETS.helmetModelUrl
const HERO_TITLE_POSITION: [number, number, number] = [0, 0.04, 1.2]
// Scribble Font: OS/2 typo ascender 1600, descender -400, units-per-em 1000.
// Troika's middle anchor therefore placed the one-line top baseline at -0.6em.
const HERO_TITLE_TOP_BASELINE_EM = -0.6

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

type JourneyState = 'idle' | 'moving' | 'complete'

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

function HeroTitleLayoutProbe({
  onLayout,
  onReady,
}: {
  onLayout: (layout: HeroTitleLayout) => void
  onReady: () => void
}) {
  const viewport = useThree((state) => state.viewport)
  const camera = useThree((state) => state.camera)
  const fontSize = Math.min(1.42, viewport.width / 5.4) * 0.7
  const titleViewport = viewport.getCurrentViewport(
    camera,
    HERO_TITLE_POSITION,
  )

  useEffect(() => {
    onLayout({
      baselineY:
        HERO_TITLE_POSITION[1] + HERO_TITLE_TOP_BASELINE_EM * fontSize,
      fontSize,
      viewportHeight: titleViewport.height,
      viewportWidth: titleViewport.width,
    })
    onReady()
  }, [
    fontSize,
    onLayout,
    onReady,
    titleViewport.height,
    titleViewport.width,
  ])

  return null
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
        resolution={384}
        roughness={0.025}
        samples={4}
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
  onTitleLayout,
  onTitleReady,
}: {
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
      <Environment background={false} files={apartmentEnvironmentUrl} />
      <HeroTitleLayoutProbe
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

function ReelCard({
  active,
  className,
  index,
  label,
  onUnavailable,
  preload,
  src,
}: {
  active: boolean
  className: string
  index: string
  label: string
  onUnavailable: () => void
  preload: boolean
  src: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !preload) return

    video.load()
  }, [preload])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.defaultMuted = true
    video.muted = true

    if (!active) {
      video.pause()
      return
    }

    const playVideo = () => {
      const playPromise = video.play()
      if (playPromise) void playPromise.catch(() => undefined)
    }

    if (typeof IntersectionObserver !== 'function') {
      playVideo()
      return () => video.pause()
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          playVideo()
        } else {
          video.pause()
        }
      },
      { threshold: 0.08 },
    )

    observer.observe(video)
    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [active])

  return (
    <figure className={`${styles.reelCard} ${className}`}>
      <video
        aria-hidden="true"
        loop
        muted
        onError={onUnavailable}
        playsInline
        preload={preload ? 'auto' : 'none'}
        ref={videoRef}
      >
        <source src={src} type="video/mp4" />
      </video>
      <span aria-hidden="true" className={styles.reelIndex}>
        {index}
      </span>
      <figcaption className={styles.visuallyHidden}>{label}</figcaption>
    </figure>
  )
}

// The glass helmet hero is the landing page at / and remains available at /hero.
export default function HeroPage() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [titleLayout, setTitleLayout] = useState<HeroTitleLayout | null>(null)
  const [titleReady, setTitleReady] = useState(false)
  const [journeyState, setJourneyState] = useState<JourneyState>('idle')
  const [reelsPrimed, setReelsPrimed] = useState(false)
  const [reelsUnavailable, setReelsUnavailable] = useState(false)
  const [heroCanvasVisible, setHeroCanvasVisible] = useState(true)
  const heroPanelRef = useRef<HTMLElement>(null)
  const replayLinkRef = useRef<HTMLAnchorElement>(null)
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
    const heroPanel = heroPanelRef.current
    if (!heroPanel || typeof IntersectionObserver !== 'function') return

    const observer = new IntersectionObserver(([entry]) => {
      setHeroCanvasVisible((current) =>
        current === entry.isIntersecting ? current : entry.isIntersecting,
      )
    })
    observer.observe(heroPanel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!titleReady) return

    const nextState = prefersReducedMotion
      ? 'complete'
      : titleLayout
        ? 'drawing'
        : null
    if (!nextState) return

    const frameId = window.requestAnimationFrame(() => {
      setIntroState((currentState) =>
        currentState === 'waiting' ? nextState : currentState,
      )
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [prefersReducedMotion, titleLayout, titleReady])

  useEffect(() => {
    if (introState !== 'drawing') return

    const timeoutId = window.setTimeout(
      () => setIntroState('complete'),
      HERO_PENCIL_REVEAL_DURATION_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [introState])

  useEffect(() => {
    if (journeyState !== 'complete') return

    const frameId = window.requestAnimationFrame(() => {
      replayLinkRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [journeyState])

  const landingReelUrls = RUNTIME_ASSETS.landingReelUrls
  const landingReelsAvailable = !reelsUnavailable

  const handleReelUnavailable = useCallback(() => {
    setReelsUnavailable(true)
    setJourneyState((currentState) =>
      currentState === 'idle' ? currentState : 'complete',
    )
  }, [])

  const primeReels = useCallback(() => {
    if (landingReelsAvailable) setReelsPrimed(true)
  }, [landingReelsAvailable])

  const startJourney = useCallback(() => {
    if (!landingReelsAvailable) {
      setJourneyState('complete')
      return
    }
    primeReels()
    setJourneyState(prefersReducedMotion ? 'complete' : 'moving')
  }, [landingReelsAvailable, prefersReducedMotion, primeReels])

  const startReplay = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      event.preventDefault()
      window.location.assign('/replay')
    },
    [],
  )

  const handleJourneyAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLDivElement>) => {
      if (
        journeyState === 'moving' &&
        event.currentTarget === event.target
      ) {
        setJourneyState('complete')
      }
    },
    [journeyState],
  )

  const journeyActive = journeyState !== 'idle'
  const trackClassName = [
    styles.track,
    journeyState === 'moving' ? styles.trackMoving : '',
    journeyState === 'complete' ? styles.trackComplete : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main className={styles.page}>
      <div
        className={trackClassName}
        onAnimationEnd={handleJourneyAnimationEnd}
      >
        <section
          ref={heroPanelRef}
          className={styles.heroPanel}
          aria-labelledby="landing-title"
        >
          <h1 className={styles.visuallyHidden} id="landing-title">
            The Onboard
          </h1>

          <ReliableCanvas
            className={styles.canvas}
            camera={{ fov: 34, position: [0, 0, 7.4] }}
            dpr={[1, 1.25]}
            fallback={<WebGLFallback surface="hero" />}
            frameloop={heroCanvasVisible ? 'always' : 'never'}
            rendererOptions={{
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
                onTitleLayout={handleTitleLayout}
                onTitleReady={handleTitleReady}
              />
            </Suspense>
          </ReliableCanvas>

          {introState !== 'waiting' && titleLayout ? (
            <HeroPencilReveal
              isComplete={introState === 'complete'}
              layout={titleLayout}
            />
          ) : null}

          <p className={styles.lapHeader}>
            George Russell · 2024 Canadian GP pole lap
          </p>

          <button
            aria-label="Start the landing film"
            className={`${styles.actionButton} ${styles.viewButton}`}
            onClick={startJourney}
            onFocus={primeReels}
            onPointerDown={primeReels}
            onPointerEnter={primeReels}
            type="button"
          >
            <span>View</span>
          </button>

          <a
            aria-label="View The Onboard repository on GitHub"
            className={styles.githubLink}
            href="https://github.com/santiagovelasquezt2/Openf1-garage"
            rel="noreferrer"
            target="_blank"
          >
            <Icon name="code" />
          </a>
        </section>

        <section
          aria-label="George Russell film sequence"
          className={styles.storyField}
        >
          {landingReelsAvailable ? (
            <>
              <ReelCard
                active={journeyActive}
                className={styles.reelOne}
                index="01"
                label="George Russell Mercedes celebration film"
                onUnavailable={handleReelUnavailable}
                preload={reelsPrimed}
                src={landingReelUrls[0]}
              />
              <ReelCard
                active={journeyActive}
                className={styles.reelTwo}
                index="02"
                label="Formula One history montage"
                onUnavailable={handleReelUnavailable}
                preload={reelsPrimed}
                src={landingReelUrls[1]}
              />
              <ReelCard
                active={journeyActive}
                className={styles.reelThree}
                index="03"
                label="George Russell race montage"
                onUnavailable={handleReelUnavailable}
                preload={reelsPrimed}
                src={landingReelUrls[2]}
              />
            </>
          ) : null}

          <div className={styles.endState}>
            <a
              className={`${styles.actionButton} ${styles.replayLink}`}
              href="/replay"
              onClick={startReplay}
              ref={replayLinkRef}
            >
              <span>Start</span>
            </a>
          </div>
        </section>
      </div>

      <p aria-live="polite" className={styles.visuallyHidden}>
        {journeyState === 'complete' ? 'Landing film complete.' : ''}
      </p>
    </main>
  )
}

useGLTF.preload(HELMET_MODEL_URL)
