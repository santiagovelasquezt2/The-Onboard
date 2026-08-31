import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { ReliableCanvas, WebGLFallback } from '../../../ui/WebGLFallback'
import styles from './TrackScene.module.css'
import { AssetErrorBoundary } from './AssetErrorBoundary'
import { Atmosphere } from './Atmosphere'
import { LapModels, type SceneCameraMode } from './LapModels'
import type { ReplayFile } from '../replay'
import type { LapWindow } from '../lapWindow'
import type { RacingLineAnchor } from '../replayDefaults'
import type {
  AuthoredLinePoint,
  CalibrationDriveInput,
  CalibrationDriveSample,
} from '../calibration/authoredRacingLine'
import type { ReplaySeekState } from '../playbackClock'
import type { ReplayCorridorSample } from './replayMotion'
import type { DrivingLinePreviewPoint } from './DrivingLinePreview'
import {
  REPLAY_QUALITY_SETTINGS,
  createReplayQualitySampler,
  observeReplayQualityFrame,
  resetReplayQualitySampler,
  resolveReplayQualityOverride,
  type ReplayRenderQuality,
} from './replayQuality'
import {
  AMBIENT_INTENSITY,
  CAR_URL,
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
  SUN_COLOR,
  SUN_DIRECTION,
  TONE_MAPPING_EXPOSURE,
  TRACK_URL,
} from './sceneConfig'

type TrackSceneProps = {
  replay: ReplayFile | null
  /** Fires only after a complete WebGL frame contains the loaded replay scene. */
  onScenePresented?: () => void
  onSceneError?: (error: Error) => void
  onWebGLUnavailable?: (error: Error) => void
  playheadSeconds: number
  playing: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  lapWindow: LapWindow
  racingLineAnchors: readonly RacingLineAnchor[]
  authoredLinePoints: readonly AuthoredLinePoint[]
  drivingLinePreviewPath?: readonly AuthoredLinePoint[]
  drivingLinePreviewPoints?: readonly DrivingLinePreviewPoint[]
  replaySeekRef?: RefObject<ReplaySeekState>
  /** One-shot demand-render signal for mutable inputs consumed inside useFrame. */
  sceneRenderEpoch?: number
  /** Visible onboard is ahead during a manual calibration recording only. */
  videoPreviewLeadSeconds?: number
  /** Visual route-time correction used to align the 3D car with the footage. */
  vehicleTimeOffsetSeconds?: number
  cameraModeOverride?: SceneCameraMode
  thirdPersonResetKey?: number
  overheadCameraHeightMeters?: number
  calibrationDriveInputRef?: RefObject<CalibrationDriveInput>
  calibrationCameraHeightRef?: RefObject<number>
  onCalibrationSample?: (sample: ReplayCorridorSample) => void
  onCalibrationDriveSample?: (sample: CalibrationDriveSample) => void
  onCalibrationDriveFrame?: (sample: CalibrationDriveSample) => void
  onCalibrationDriveDiscontinuity?: () => void
  onCalibrationSectionEnd?: (mode: 'record' | 'review') => void
  fpsElementRef?: RefObject<HTMLElement | null>
}

/** Sun placement inside the reflection-only environment scene. */
const ENV_SUN = new THREE.Vector3(...SUN_DIRECTION)
  .normalize()
  .multiplyScalar(30)
  .toArray()

/**
 * Everything that doesn't need to know where the car is. The sun itself lives
 * with the car (see SunLight) so its shadow frustum can stay tight.
 */
const SceneLights = memo(function SceneLights() {
  return (
    <>
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />

      <Atmosphere />

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
        <color attach="background" args={['#6f9fc4']} />
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
})

type ReplayPerformanceControllerProps = {
  adaptiveQuality: boolean
  fpsElementRef?: RefObject<HTMLElement | null>
  onReduceQuality: () => void
  playing: boolean
  quality: ReplayRenderQuality
}

/**
 * Demand mode sleeps completely while paused. During playback this component
 * schedules the next frame, samples sustained frame rate, and updates the
 * existing FPS label without routing every frame through React state.
 */
function ReplayPerformanceController({
  adaptiveQuality,
  fpsElementRef,
  onReduceQuality,
  playing,
  quality,
}: ReplayPerformanceControllerProps) {
  const invalidate = useThree((state) => state.invalidate)
  const qualitySamplerRef = useRef(createReplayQualitySampler())
  const fpsFramesRef = useRef(0)
  const fpsElapsedRef = useRef(0)

  useEffect(() => {
    resetReplayQualitySampler(qualitySamplerRef.current)
    fpsFramesRef.current = 0
    fpsElapsedRef.current = 0
    const element = fpsElementRef?.current
    if (element) {
      // The FPS readout is intentionally an imperative render-loop sink.
      // oxlint-disable-next-line react/immutability
      element.textContent = playing ? '— fps' : 'paused'
    }
    if (playing) invalidate()
  }, [fpsElementRef, invalidate, playing, quality])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return
      resetReplayQualitySampler(qualitySamplerRef.current)
      if (playing) invalidate()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [invalidate, playing])

  useFrame((_, deltaSeconds) => {
    if (!playing) return

    // One invalidation per rendered frame keeps demand mode continuous only
    // while the shared video clock is actually running.
    invalidate()

    const element = fpsElementRef?.current
    if (element) {
      fpsFramesRef.current += 1
      fpsElapsedRef.current += deltaSeconds
      if (fpsElapsedRef.current >= 0.25) {
        const fps = Math.round(fpsFramesRef.current / fpsElapsedRef.current)
        // Avoid a React render four times per second for diagnostic text.
        // oxlint-disable-next-line react/immutability
        element.textContent = `${fps} fps`
        fpsFramesRef.current = 0
        fpsElapsedRef.current = 0
      }
    }

    if (
      !adaptiveQuality ||
      quality !== 'high' ||
      document.visibilityState !== 'visible'
    ) {
      return
    }
    const observation = observeReplayQualityFrame(
      qualitySamplerRef.current,
      deltaSeconds,
    )
    if (observation?.shouldReduce) onReduceQuality()
  })

  return null
}

function SceneRenderEpochInvalidator({ epoch }: { epoch?: number }) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    if (typeof epoch === 'number') invalidate()
  }, [epoch, invalidate])

  return null
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

type SceneFrameReporterProps = {
  enabled: boolean
  onPresented?: () => void
}

/**
 * `useProgress` only knows that a loader has settled. This waits for the root
 * Three scene's post-render hook, so a transition can reveal only after a
 * complete canvas frame has actually been drawn.
 */
function SceneFrameReporter({
  enabled,
  onPresented,
}: SceneFrameReporterProps) {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const onPresentedRef = useRef(onPresented)
  const hasPresentedRef = useRef(false)

  useEffect(() => {
    onPresentedRef.current = onPresented
  }, [onPresented])

  useEffect(() => {
    if (!enabled || !onPresented || hasPresentedRef.current) return

    let disposed = false
    const previousAfterRender = scene.onAfterRender
    const reportAfterRender: NonNullable<THREE.Object3D['onAfterRender']> = (
      ...args
    ) => {
      previousAfterRender?.(...args)
      if (disposed || hasPresentedRef.current) return

      hasPresentedRef.current = true
      // Resolve after WebGLRenderer completes the current render call. This
      // keeps React's state update out of Three's render traversal.
      void Promise.resolve().then(() => {
        if (!disposed) onPresentedRef.current?.()
      })
    }

    // oxlint-disable-next-line react/immutability -- Three exposes this hook on its mutable scene graph.
    scene.onAfterRender = reportAfterRender
    // Demand mode can be asleep after the assets commit. Request the frame the
    // post-render callback is waiting for explicitly.
    invalidate()

    return () => {
      disposed = true
      if (scene.onAfterRender === reportAfterRender) {
        // oxlint-disable-next-line react/immutability -- restore the renderer hook we replaced above.
        scene.onAfterRender = previousAfterRender
      }
    }
  }, [enabled, invalidate, onPresented, scene])

  return null
}

export const TrackScene = memo(function TrackScene({
  replay,
  onScenePresented,
  onSceneError,
  onWebGLUnavailable,
  playheadSeconds,
  playing,
  videoRef,
  lapWindow,
  racingLineAnchors,
  authoredLinePoints,
  drivingLinePreviewPath,
  drivingLinePreviewPoints,
  replaySeekRef,
  sceneRenderEpoch,
  videoPreviewLeadSeconds,
  vehicleTimeOffsetSeconds,
  cameraModeOverride,
  thirdPersonResetKey,
  overheadCameraHeightMeters,
  calibrationDriveInputRef,
  calibrationCameraHeightRef,
  onCalibrationSample,
  onCalibrationDriveSample,
  onCalibrationDriveFrame,
  onCalibrationDriveDiscontinuity,
  onCalibrationSectionEnd,
  fpsElementRef,
}: TrackSceneProps) {
  const [qualityOverride] = useState(() =>
    resolveReplayQualityOverride(window.location.search),
  )
  const [renderQuality, setRenderQuality] = useState<ReplayRenderQuality>(
    qualityOverride ?? 'high',
  )
  const qualitySettings = REPLAY_QUALITY_SETTINGS[renderQuality]
  const reduceQuality = useCallback(() => {
    setRenderQuality((current) =>
      current === 'high' ? 'reduced' : current,
    )
  }, [])

  return (
    <div
      className={styles.canvasWrap}
      data-adaptive-quality={qualityOverride === null ? true : undefined}
      data-render-quality={renderQuality}
      data-shadow-map-size={qualitySettings.shadowMapSize}
    >
      <AssetErrorBoundary fallback={<ErrorOverlay />} onError={onSceneError}>
        <ReliableCanvas
          // PCF, not "soft": three r185 deprecated PCFSoftShadowMap and silently
          // downgrades it. A tight SHADOW_EXTENT box keeps PCF looking clean.
          shadows="percentage"
          // Playback invalidates continuously; paused scrubs/camera controls
          // invalidate explicitly, so idle scenes consume no render loop.
          frameloop="demand"
          dpr={qualitySettings.dpr}
          camera={{
            fov: CAMERA_FOV,
            near: CAMERA_NEAR,
            far: CAMERA_FAR,
            // Onboard-ish placeholder until LapModels owns the live T-cam.
            position: [0, ONBOARD_CAMERA_HEIGHT, ONBOARD_CAMERA_BACK],
          }}
          fallback={<WebGLFallback surface="replay" />}
          onUnavailable={onWebGLUnavailable}
          rendererOptions={{
            antialias: true,
            // The scene spans 0.25 m to ~15 km; without this the track z-fights.
            logarithmicDepthBuffer: true,
          }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = TONE_MAPPING_EXPOSURE
          }}
        >
          <SceneRenderEpochInvalidator epoch={sceneRenderEpoch} />
          <ReplayPerformanceController
            adaptiveQuality={qualityOverride === null}
            fpsElementRef={fpsElementRef}
            onReduceQuality={reduceQuality}
            playing={playing}
            quality={renderQuality}
          />
          <SceneLights />
          <Suspense fallback={null}>
            <LapModels
              replay={replay}
              playheadSeconds={playheadSeconds}
              videoRef={videoRef}
              lapWindow={lapWindow}
              racingLineAnchors={racingLineAnchors}
              authoredLinePoints={authoredLinePoints}
              drivingLinePreviewPath={drivingLinePreviewPath}
              drivingLinePreviewPoints={drivingLinePreviewPoints}
              replaySeekRef={replaySeekRef}
              videoPreviewLeadSeconds={videoPreviewLeadSeconds}
              vehicleTimeOffsetSeconds={vehicleTimeOffsetSeconds}
              cameraModeOverride={cameraModeOverride}
              thirdPersonResetKey={thirdPersonResetKey}
              overheadCameraHeightMeters={overheadCameraHeightMeters}
              calibrationDriveInputRef={calibrationDriveInputRef}
              calibrationCameraHeightRef={calibrationCameraHeightRef}
              onCalibrationSample={onCalibrationSample}
              onCalibrationDriveSample={onCalibrationDriveSample}
              onCalibrationDriveFrame={onCalibrationDriveFrame}
              onCalibrationDriveDiscontinuity={
                onCalibrationDriveDiscontinuity
              }
              onCalibrationSectionEnd={onCalibrationSectionEnd}
              shadowMapSize={qualitySettings.shadowMapSize}
            />
            <SceneFrameReporter
              enabled={replay !== null}
              onPresented={onScenePresented}
            />
          </Suspense>
        </ReliableCanvas>
        <LoadingOverlay />
      </AssetErrorBoundary>
    </div>
  )
})
