import { Suspense, type RefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, Sky, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import styles from './TrackScene.module.css'
import { AssetErrorBoundary } from './scene/AssetErrorBoundary'
import { LapModels } from './scene/LapModels'
import { CAR_URL, TRACK_URL } from './scene/urls'
import type { ReplayFile } from '../replay'
import type { LapWindow } from '../lapWindow'
import type { RacingLineAnchor } from '../racingLineCalibration'
import type { ReplayCorridorSample } from './scene/replayMotion'
import {
  AMBIENT_INTENSITY,
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  ENV_RESOLUTION,
  FOG_COLOR,
  FOG_DENSITY,
  HEMI_GROUND_COLOR,
  HEMI_INTENSITY,
  HEMI_SKY_COLOR,
  ONBOARD_CAMERA_BACK,
  ONBOARD_CAMERA_HEIGHT,
  SKY_DISTANCE,
  SKY_MIE_COEFFICIENT,
  SKY_MIE_DIRECTIONAL_G,
  SKY_RAYLEIGH,
  SKY_TURBIDITY,
  SUN_COLOR,
  SUN_DIRECTION,
  TONE_MAPPING_EXPOSURE,
} from './scene/sceneConfig'

type TrackSceneProps = {
  replay: ReplayFile | null
  playheadSeconds: number
  videoRef: RefObject<HTMLVideoElement | null>
  lapWindow: LapWindow
  racingLineAnchors: readonly RacingLineAnchor[]
  onCalibrationSample?: (sample: ReplayCorridorSample) => void
}

const SUN_POSITION: [number, number, number] = [...SUN_DIRECTION]

/** Sun placement inside the reflection-only environment scene. */
const ENV_SUN = new THREE.Vector3(...SUN_DIRECTION)
  .normalize()
  .multiplyScalar(30)
  .toArray()

/**
 * Everything that doesn't need to know where the car is. The sun itself lives
 * with the car (see SunLight) so its shadow frustum can stay tight.
 */
function SceneLights() {
  return (
    <>
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />

      <Sky
        distance={SKY_DISTANCE}
        sunPosition={SUN_POSITION}
        turbidity={SKY_TURBIDITY}
        rayleigh={SKY_RAYLEIGH}
        mieCoefficient={SKY_MIE_COEFFICIENT}
        mieDirectionalG={SKY_MIE_DIRECTIONAL_G}
      />

      <hemisphereLight
        args={[HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_INTENSITY]}
      />
      <ambientLight intensity={AMBIENT_INTENSITY} />

      {/*
        Reflections for the car's bodywork. Lightformers only — no preset and no
        HDR fetch, so the scene renders with zero network access.
      */}
      <Environment resolution={ENV_RESOLUTION} frames={1} background={false}>
        {/* A broad daylight base keeps glossy black bodywork from reflecting a
            mostly empty cube. The lightformers below provide readable shapes. */}
        <color attach="background" args={['#60778a']} />
        <Lightformer
          form="rect"
          intensity={2.2}
          color={HEMI_SKY_COLOR}
          position={[0, 26, 0]}
          scale={[60, 60]}
        />
        <Lightformer
          form="circle"
          intensity={14}
          color={SUN_COLOR}
          position={ENV_SUN}
          scale={8}
        />
        <Lightformer
          form="rect"
          intensity={1.1}
          color="#d3e2f2"
          position={[0, 4, -26]}
          scale={[60, 10]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#cddcec"
          position={[0, 4, 26]}
          scale={[60, 10]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#cddcec"
          position={[-26, 4, 0]}
          scale={[60, 10]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#cddcec"
          position={[26, 4, 0]}
          scale={[60, 10]}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color={HEMI_GROUND_COLOR}
          position={[0, -14, 0]}
          scale={[60, 60]}
        />
      </Environment>
    </>
  )
}

function LoadingOverlay() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className={styles.overlay} role="status">
      <p className={styles.overlayTitle}>Loading track…</p>
      <p className={styles.overlayHint}>
        Montreal + W14 GLBs — {Math.round(progress)}%
      </p>
    </div>
  )
}

function ErrorOverlay() {
  return (
    <div className={styles.overlay} role="alert">
      <p className={styles.overlayTitle}>Couldn’t load 3D assets</p>
      <p className={styles.overlayHint}>
        Expected <code>{TRACK_URL}</code> and <code>{CAR_URL}</code>. Check{' '}
        <code>public/media/</code> (see README).
      </p>
    </div>
  )
}

export function TrackScene({
  replay,
  playheadSeconds,
  videoRef,
  lapWindow,
  racingLineAnchors,
  onCalibrationSample,
}: TrackSceneProps) {
  return (
    <div className={styles.canvasWrap}>
      <AssetErrorBoundary fallback={<ErrorOverlay />}>
        <Canvas
          // PCF, not "soft": three r185 deprecated PCFSoftShadowMap and silently
          // downgrades it. A tight SHADOW_EXTENT box keeps PCF looking clean.
          shadows="percentage"
          // Always tick so scrubbed onboard T-cam frames stay visible while paused.
          frameloop="always"
          dpr={[1, 1.5]}
          camera={{
            fov: CAMERA_FOV,
            near: CAMERA_NEAR,
            far: CAMERA_FAR,
            // Onboard-ish placeholder until LapModels owns the live T-cam.
            position: [0, ONBOARD_CAMERA_HEIGHT, ONBOARD_CAMERA_BACK],
          }}
          gl={{
            antialias: true,
            // The scene spans 0.25 m to ~15 km; without this the track z-fights.
            logarithmicDepthBuffer: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: TONE_MAPPING_EXPOSURE,
          }}
        >
          <SceneLights />
          <Suspense fallback={null}>
            <LapModels
              replay={replay}
              playheadSeconds={playheadSeconds}
              videoRef={videoRef}
              lapWindow={lapWindow}
              racingLineAnchors={racingLineAnchors}
              onCalibrationSample={onCalibrationSample}
            />
          </Suspense>
        </Canvas>
        <LoadingOverlay />
      </AssetErrorBoundary>
    </div>
  )
}
