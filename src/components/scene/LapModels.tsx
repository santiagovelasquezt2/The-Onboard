import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { PerspectiveCamera, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { LapWindow } from '../../lapWindow'
import { vehicleLapTimeFromPreviewVideoLapTime } from '../../calibrationVideoLead'
import { drivingLineComparisonVehicleTime } from '../../drivingLineComparisonTiming'
import {
  advancePlaybackClock,
  createPlaybackClock,
  resetPlaybackClock,
  type ReplaySeekState,
} from '../../playbackClock'
import {
  applySmoothedPose,
  createSmoothedPoseState,
} from '../../motionSmoothing'
import { MotionInstrumenter } from '../../motionInstrumentation'
import type { ReplayFile } from '../../replay'
import type { RacingLineAnchor } from '../../racingLineCalibration'
import {
  replaySyncOffsetAtLapTime,
  type ReplaySyncAnchor,
} from '../../replaySyncCalibration'
import {
  forwardProgressDistance,
  type AuthoredLinePoint,
  type CalibrationDriveInput,
  type CalibrationDriveSample,
} from '../../authoredRacingLine'
import { AUDITED_CURB_CONTACTS } from '../../curbContacts'
import {
  collectSurfaceMeshes,
  createAsphaltProjector,
  resolveCarPose,
  resolveReplayCarPose,
} from './carPose'
import {
  createReplayMotionRoute,
  createTrackBoundReplayMotionRoute,
  type ReplayCorridorSample,
  type ReplayMotionRoute,
  type ReplayMotionSample,
} from './replayMotion'
import {
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_TARGET_FORWARD,
  CAMERA_TARGET_HEIGHT,
  CHASE_DISTANCE,
  CHASE_HEIGHT,
  CHASE_LATERAL_OFFSET,
  CUTOUT_ALPHA_TEST,
  CUTOUT_MATERIAL_PATTERN,
  CURB_MATERIAL_PATTERN,
  DOUBLE_SIDED_MATERIAL_PATTERN,
  GRADIENT_MESH_PATTERN,
  GRASS_STRAW_MATERIAL_PATTERN,
  GROOVE_ALPHA_TEST,
  GROOVE_MATERIAL_PATTERN,
  GROOVE_OPACITY,
  HIDE_GRADIENT_MESH,
  HIDE_GRASS_STRAWS,
  ONBOARD_CAMERA_BACK,
  ONBOARD_CAMERA_HEIGHT,
  ONBOARD_CAMERA_LATERAL,
  ONBOARD_LOOK_FORWARD,
  ONBOARD_LOOK_HEIGHT,
  OVERHEAD_CAMERA_HEIGHT,
  REPLAY_CALIBRATION_WHITE_LINE_ALLOWANCE_METERS,
  REPLAY_DRIVEABLE_MATERIAL_PATTERN,
  REPLAY_CURB_TRANSITION_METERS,
  REPLAY_CURB_PHASE_SEARCH_METERS,
  REPLAY_HEADING_HALF_DISTANCE_METERS,
  REPLAY_LATERAL_NUDGE,
  REPLAY_MOTION_SMOOTHING,
  REPLAY_RACING_LINE_ANCHOR_INFLUENCE_METERS,
  REPLAY_START_ROUTE_TIME_MS,
  REPLAY_TRACK_CORRIDOR_ENABLED,
  REPLAY_TRACK_CORRIDOR_MARGIN_METERS,
  REPLAY_TRACK_CORRIDOR_MAX_LATERAL_SLOPE,
  REPLAY_TRACK_CORRIDOR_MAX_WIDTH_METERS,
  REPLAY_TRACK_CORRIDOR_SAMPLE_SPACING_METERS,
  REPLAY_TRACK_CORRIDOR_SCAN_STEP_METERS,
  REPLAY_TRACK_CORRIDOR_SEARCH_METERS,
  REPLAY_TRACK_CORRIDOR_SMOOTHING_PASSES,
  REPLAY_WHEEL_CENTER_HALF_TRACK_METERS,
  REPLAY_WHEEL_CENTER_HALF_WHEELBASE_METERS,
  isMotionDebugEnabled,
} from './sceneConfig'
import { SunLight } from './SunLight'
import {
  DrivingLinePreview,
  type DrivingLinePreviewPoint,
} from './DrivingLinePreview'
import { CAR_URL, TRACK_URL } from './urls'

export type SceneCameraMode = 'overhead' | 'chase' | 'onboard'

const CALIBRATION_LATERAL_SPEED_METERS_PER_SECOND = 2.4
const CALIBRATION_CAPTURE_SPACING_METERS = 1.8
const CALIBRATION_CAPTURE_OFFSET_STEP_METERS = 0.04
const CALIBRATION_MAXIMUM_FORWARD_PROGRESS_STEP = 0.01

export type OnboardCameraRig = {
  back: number
  height: number
  lookHeight: number
  lookForward: number
  fov: number
}

function resolveCameraMode(): SceneCameraMode {
  const search = new URLSearchParams(window.location.search)
  if (search.get('camera') === 'overhead' || search.get('calibrate') === '1') {
    return 'overhead'
  }
  if (search.get('camera') === 'chase') return 'chase'
  return 'onboard'
}

/** `?tcam=back,height,lookH,lookF,fov` — live PiP matching without rebuilds. */
function resolveOnboardCameraRig(): OnboardCameraRig {
  const defaults: OnboardCameraRig = {
    back: ONBOARD_CAMERA_BACK,
    height: ONBOARD_CAMERA_HEIGHT,
    lookHeight: ONBOARD_LOOK_HEIGHT,
    lookForward: ONBOARD_LOOK_FORWARD,
    fov: CAMERA_FOV,
  }
  const raw = new URLSearchParams(window.location.search).get('tcam')
  if (!raw) return defaults
  const parts = raw.split(',').map((part) => Number(part.trim()))
  if (parts.length < 5 || parts.some((n) => !Number.isFinite(n))) return defaults
  return {
    back: parts[0],
    height: parts[1],
    lookHeight: parts[2],
    lookForward: parts[3],
    fov: parts[4],
  }
}

type LapModelsProps = {
  replay: ReplayFile | null
  playheadSeconds: number
  videoRef: RefObject<HTMLVideoElement | null>
  lapWindow: LapWindow
  racingLineAnchors: readonly RacingLineAnchor[]
  authoredLinePoints: readonly AuthoredLinePoint[]
  drivingLinePreviewPath?: readonly AuthoredLinePoint[]
  drivingLinePreviewPoints?: readonly DrivingLinePreviewPoint[]
  replaySyncAnchors: readonly ReplaySyncAnchor[]
  replaySeekRef?: RefObject<ReplaySeekState>
  videoPreviewLeadSeconds?: number
  vehicleTimeOffsetSeconds?: number
  cameraModeOverride?: SceneCameraMode
  overheadCameraHeightMeters?: number
  calibrationDriveInputRef?: RefObject<CalibrationDriveInput>
  calibrationCameraHeightRef?: RefObject<number>
  onCalibrationSample?: (sample: ReplayCorridorSample) => void
  onCalibrationDriveSample?: (sample: CalibrationDriveSample) => void
  onCalibrationDriveFrame?: (sample: CalibrationDriveSample) => void
  onCalibrationDriveDiscontinuity?: () => void
  onCalibrationSectionEnd?: (mode: 'record' | 'review') => void
}

function prepareTrack(scene: THREE.Group): THREE.Group {
  const root = scene.clone(true)
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.castShadow = false
    object.receiveShadow = true

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) {
      if (!material) continue
      material.side = DOUBLE_SIDED_MATERIAL_PATTERN.test(material.name)
        ? THREE.DoubleSide
        : THREE.FrontSide
      if (GROOVE_MATERIAL_PATTERN.test(material.name)) {
        material.alphaTest = GROOVE_ALPHA_TEST
        material.transparent = true
        material.opacity = GROOVE_OPACITY
        material.depthWrite = false
        material.needsUpdate = true
      } else if (CUTOUT_MATERIAL_PATTERN.test(material.name)) {
        material.alphaTest = CUTOUT_ALPHA_TEST
        material.transparent = false
        material.depthWrite = true
        material.needsUpdate = true
      }
      if (
        HIDE_GRASS_STRAWS &&
        GRASS_STRAW_MATERIAL_PATTERN.test(material.name)
      ) {
        material.visible = false
      }
      if (HIDE_GRADIENT_MESH && GRADIENT_MESH_PATTERN.test(material.name)) {
        object.visible = false
      }
    }
  })
  return root
}

function prepareCar(scene: THREE.Group): THREE.Group {
  const root = scene.clone(true)
  const tunedMaterials = new WeakMap<THREE.Material, THREE.Material>()

  const tuneMaterial = (source: THREE.Material): THREE.Material => {
    const cached = tunedMaterials.get(source)
    if (cached) return cached

    const material = source.clone()
    material.side = THREE.FrontSide

    if (material instanceof THREE.MeshStandardMaterial) {
      const name = material.name.toLowerCase()
      if (/tire/.test(name)) {
        material.metalness = 0
        material.roughness = /tread/.test(name) ? 0.86 : 0.78
        material.envMapIntensity = 0.3
      } else if (/carbon/.test(name)) {
        material.metalness = 0
        material.roughness = 0.34
        material.envMapIntensity = 0.8
      } else if (/mercedes_paint/.test(name)) {
        material.metalness = 0.05
        material.roughness = 0.22
        material.envMapIntensity = 1.2
        if (material instanceof THREE.MeshPhysicalMaterial) {
          material.clearcoat = 0.65
          material.clearcoatRoughness = 0.18
        }
      } else if (/decal|number|driver_color/.test(name)) {
        material.metalness = 0
        material.roughness = 0.34
        material.envMapIntensity = 0.85
      } else if (/disc|wheel_hub|\bmetal\b|paddle/.test(name)) {
        material.metalness = 0.72
        material.roughness = Math.max(material.roughness, 0.36)
        material.envMapIntensity = 1.1
      } else if (/mirror/.test(name)) {
        material.metalness = 0.9
        material.roughness = 0.12
        material.envMapIntensity = 1.4
      } else if (/light|clearled/.test(name)) {
        material.metalness = 0
        material.roughness = 0.24
        material.envMapIntensity = 0.9
      } else {
        material.metalness = 0.02
        material.roughness = Math.max(material.roughness, 0.36)
        material.envMapIntensity = 0.9
      }
      material.needsUpdate = true
    }

    tunedMaterials.set(source, material)
    return material
  }

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    // Real FOM T-cam doesn't see its own mount; hide the wing/airbox camera
    // meshes so the synthetic onboard lens isn't buried in opaque bodywork.
    if (/camera_wing/i.test(object.name)) {
      object.visible = false
      return
    }
    object.castShadow = true
    object.receiveShadow = true
    object.material = Array.isArray(object.material)
      ? object.material.map(tuneMaterial)
      : tuneMaterial(object.material)
  })
  return root
}

export function LapModels({
  replay,
  playheadSeconds,
  videoRef,
  lapWindow,
  racingLineAnchors,
  authoredLinePoints,
  drivingLinePreviewPath,
  drivingLinePreviewPoints = [],
  replaySyncAnchors,
  replaySeekRef,
  videoPreviewLeadSeconds = 0,
  vehicleTimeOffsetSeconds = 0,
  cameraModeOverride,
  overheadCameraHeightMeters,
  calibrationDriveInputRef,
  calibrationCameraHeightRef,
  onCalibrationSample,
  onCalibrationDriveSample,
  onCalibrationDriveFrame,
  onCalibrationDriveDiscontinuity,
  onCalibrationSectionEnd,
}: LapModelsProps) {
  const trackGltf = useGLTF(TRACK_URL)
  const carGltf = useGLTF(CAR_URL)
  const carRootRef = useRef<THREE.Group>(null)
  const sunRef = useRef<THREE.Group>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const cameraReadyRef = useRef(false)
  const playbackClockRef = useRef(createPlaybackClock())
  const smoothedPoseRef = useRef(createSmoothedPoseState())
  const motionInstrumenterRef = useRef<MotionInstrumenter | null>(null)
  const lastReplayPoseRef = useRef<ReturnType<
    typeof resolveReplayCarPose
  > | null>(null)
  const previousMediaPlayingRef = useRef<boolean | null>(null)
  const previousReplaySeekEpochRef = useRef<number | null>(null)
  const previousReplayRouteRef = useRef<ReplayMotionRoute | null | undefined>(
    undefined,
  )
  const lastCalibrationSampleLapRef = useRef<number | null>(null)
  const lastCalibrationSampleOffsetRef = useRef<number | null>(null)
  const lastCalibrationSampleBoundaryRef = useRef<boolean | null>(null)
  const lastCalibrationSampleAuthoredWeightRef = useRef<number | null>(null)
  const calibrationDriveStateRef = useRef({
    sessionId: -1,
    offsetMeters: 0,
    previousFrameProgress: null as number | null,
    lastCapturedProgress: null as number | null,
    lastCapturedOffset: null as number | null,
    lastDirection: 0 as -1 | 0 | 1,
  })
  const calibrationSectionEndSessionRef = useRef(-1)
  const cameraBasisRef = useRef({
    forward: new THREE.Vector3(0, 0, 1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  })
  const cameraTargetRef = useRef(new THREE.Vector3())
  const onboardWorldPosRef = useRef(new THREE.Vector3())
  const onboardProjectRef = useRef(new THREE.Vector3())
  const invalidate = useThree((state) => state.invalidate)

  const track = useMemo(() => prepareTrack(trackGltf.scene), [trackGltf.scene])
  const car = useMemo(() => prepareCar(carGltf.scene), [carGltf.scene])
  const spawnPose = useMemo(() => resolveCarPose(track), [track])
  const driveableMeshes = useMemo(
    () => collectSurfaceMeshes(track, REPLAY_DRIVEABLE_MATERIAL_PATTERN),
    [track],
  )
  const driveableProjector = useMemo(
    () =>
      createAsphaltProjector(
        driveableMeshes,
        REPLAY_DRIVEABLE_MATERIAL_PATTERN,
      ),
    [driveableMeshes],
  )
  const grooveMeshes = useMemo(
    () => collectSurfaceMeshes(track, GROOVE_MATERIAL_PATTERN),
    [track],
  )
  const grooveProjector = useMemo(
    () => createAsphaltProjector(grooveMeshes, GROOVE_MATERIAL_PATTERN),
    [grooveMeshes],
  )
  const curbMeshes = useMemo(
    () => collectSurfaceMeshes(track, CURB_MATERIAL_PATTERN),
    [track],
  )
  const curbProjector = useMemo(
    () => createAsphaltProjector(curbMeshes, CURB_MATERIAL_PATTERN),
    [curbMeshes],
  )
  const smoothMotion = useMemo(
    () =>
      REPLAY_MOTION_SMOOTHING &&
      new URLSearchParams(window.location.search).get('motion') !== 'raw',
    [],
  )
  const motionDebug = useMemo(() => isMotionDebugEnabled(), [])
  useEffect(() => {
    if (!motionDebug) return
    motionInstrumenterRef.current = new MotionInstrumenter()
    return () => {
      motionInstrumenterRef.current = null
    }
  }, [motionDebug])
  // OpenF1 has no camera pose / steering / mount fields — T-cam is synthetic
  // from car forward/up (see sceneConfig camera note). The calibration panel
  // can override its default overhead view for comparison during a live or
  // paused section recording.
  const defaultCameraMode = useMemo(() => resolveCameraMode(), [])
  const cameraMode = cameraModeOverride ?? defaultCameraMode
  const onboardRig = useMemo(() => resolveOnboardCameraRig(), [])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(
      window as Window & {
        __tcam?: OnboardCameraRig
      }
    ).__tcam = onboardRig
  }, [onboardRig])
  const durationMs =
    (replay?.lap.lap_duration ?? lapWindow.lapDurationSeconds) * 1000
  const routeTimeMsAtLapTime = useMemo(
    () => (lapTimeSeconds: number) =>
      lapTimeSeconds * 1000 +
      REPLAY_START_ROUTE_TIME_MS +
      replaySyncOffsetAtLapTime(
        replaySyncAnchors,
        lapTimeSeconds,
        durationMs / 1000,
      ) *
        1000,
    [durationMs, replaySyncAnchors],
  )
  const motionRoute = useMemo(
    () =>
      smoothMotion && replay
        ? createReplayMotionRoute(
            replay.location,
            replay.car_data,
            durationMs,
            REPLAY_START_ROUTE_TIME_MS,
            REPLAY_HEADING_HALF_DISTANCE_METERS,
          )
        : null,
    [durationMs, replay, smoothMotion],
  )
  const replayRoute = useMemo(() => {
    if (!motionRoute || !REPLAY_TRACK_CORRIDOR_ENABLED) return motionRoute
    const trackBoundRoute = createTrackBoundReplayMotionRoute(
      motionRoute,
      driveableProjector,
      {
        desiredLateralOffsetMeters: REPLAY_LATERAL_NUDGE,
        guideSurface: grooveProjector,
        curbSurface: curbProjector,
        marginMeters: REPLAY_TRACK_CORRIDOR_MARGIN_METERS,
        calibrationWhiteLineAllowanceMeters:
          REPLAY_CALIBRATION_WHITE_LINE_ALLOWANCE_METERS,
        searchMeters: REPLAY_TRACK_CORRIDOR_SEARCH_METERS,
        maximumRoadWidthMeters: REPLAY_TRACK_CORRIDOR_MAX_WIDTH_METERS,
        scanStepMeters: REPLAY_TRACK_CORRIDOR_SCAN_STEP_METERS,
        sampleSpacingMeters: REPLAY_TRACK_CORRIDOR_SAMPLE_SPACING_METERS,
        smoothingPasses: REPLAY_TRACK_CORRIDOR_SMOOTHING_PASSES,
        maximumLateralSlope: REPLAY_TRACK_CORRIDOR_MAX_LATERAL_SLOPE,
        anchorInfluenceMeters: REPLAY_RACING_LINE_ANCHOR_INFLUENCE_METERS,
        curbTransitionMeters: REPLAY_CURB_TRANSITION_METERS,
        curbPhaseSearchMeters: REPLAY_CURB_PHASE_SEARCH_METERS,
        wheelCenterHalfTrackMeters: REPLAY_WHEEL_CENTER_HALF_TRACK_METERS,
        wheelCenterHalfWheelbaseMeters:
          REPLAY_WHEEL_CENTER_HALF_WHEELBASE_METERS,
        lateralIntentAnchors: racingLineAnchors.map((anchor) => ({
          routeTimeMs: routeTimeMsAtLapTime(anchor.lapTimeSeconds),
          deltaMeters: anchor.deltaMeters,
        })),
        authoredLinePoints,
        curbContactWindows: AUDITED_CURB_CONTACTS.map((contact) => ({
          startRouteTimeMs: routeTimeMsAtLapTime(
            contact.startLapTimeSeconds,
          ),
          endRouteTimeMs: routeTimeMsAtLapTime(contact.endLapTimeSeconds),
          // Audited contacts name the onboard tire side; use it directly for
          // road-edge and kerb targeting (no model-basis flip).
          side: contact.side,
          onboardSide: contact.side,
          label: contact.label,
          blend: contact.blend,
          lateralNudgeMeters: contact.lateralNudgeMeters,
          whiteLineInsetMeters: contact.whiteLineInsetMeters,
        })),
      },
    )
    return trackBoundRoute
  }, [
    curbProjector,
    driveableProjector,
    grooveProjector,
    motionRoute,
    routeTimeMsAtLapTime,
    authoredLinePoints,
    racingLineAnchors,
  ])

  useEffect(() => {
    if (!import.meta.env.DEV || !replayRoute) return
    console.debug(
      'Replay road corridor',
      JSON.stringify(replayRoute.corridorDiagnostics),
    )
    ;(
      window as Window & {
        __replayRoute?: typeof replayRoute
        __sampleCorridor?: (lapTimeSeconds: number) => unknown
      }
    ).__replayRoute = replayRoute
    ;(
      window as Window & {
        __sampleCorridor?: (lapTimeSeconds: number) => unknown
      }
    ).__sampleCorridor = (lapTimeSeconds: number) =>
      replayRoute.corridorSample?.(
        routeTimeMsAtLapTime(lapTimeSeconds),
      ) ?? null
  }, [replayRoute, routeTimeMsAtLapTime])

  useEffect(() => {
    lastCalibrationSampleLapRef.current = null
    lastCalibrationSampleOffsetRef.current = null
    lastCalibrationSampleBoundaryRef.current = null
    lastCalibrationSampleAuthoredWeightRef.current = null
    invalidate()
  }, [invalidate, replayRoute])

  // Demand frameloop skips useFrame while paused; scrubbing must invalidate.
  useEffect(() => {
    invalidate()
  }, [invalidate, playheadSeconds])

  useFrame((_, deltaSeconds) => {
    const carRoot = carRootRef.current
    const sun = sunRef.current
    const camera = cameraRef.current
    if (!carRoot || !sun || !camera) return

    if (import.meta.env.DEV && replayRoute) {
      const w = window as Window & {
        __replayRoute?: typeof replayRoute
        __sampleCorridor?: (lapTimeSeconds: number) => unknown
      }
      if (w.__replayRoute !== replayRoute) {
        w.__replayRoute = replayRoute
        w.__sampleCorridor = (lapTimeSeconds: number) =>
          replayRoute.corridorSample?.(
            routeTimeMsAtLapTime(lapTimeSeconds),
          ) ?? null
      }
    }

    const video = videoRef.current
    const rawVideoLapTimeSeconds = video
      ? Math.min(
          lapWindow.lapDurationSeconds + Math.max(0, videoPreviewLeadSeconds),
          Math.max(
            -Math.max(0, lapWindow.videoStartSeconds),
            video.currentTime - lapWindow.videoStartSeconds,
          ),
        )
      : playheadSeconds
    const videoLapTimeSeconds = video
      ? vehicleLapTimeFromPreviewVideoLapTime(
          rawVideoLapTimeSeconds,
          videoPreviewLeadSeconds,
          lapWindow,
        )
      : rawVideoLapTimeSeconds
    const mediaPlaying = Boolean(video && !video.paused && !video.ended)
    const frameDelta = Math.min(deltaSeconds, 0.05)
    const playbackClock = playbackClockRef.current
    const pausedTransition =
      previousMediaPlayingRef.current === true && !mediaPlaying
    const replaySeekState = replaySeekRef?.current
    const replaySeekEpoch = replaySeekState?.seekEpoch
    const pendingLapTimeSeconds = replaySeekState?.pendingLapTimeSeconds
    const hasPendingReplaySeek =
      typeof replaySeekEpoch === 'number' &&
      replaySeekEpoch !== previousReplaySeekEpochRef.current
    const waitingForSeek =
      hasPendingReplaySeek &&
      typeof pendingLapTimeSeconds === 'number' &&
      (Boolean(video?.seeking) ||
        Math.abs(videoLapTimeSeconds - pendingLapTimeSeconds) > 0.03)
    const explicitSeek = !waitingForSeek && hasPendingReplaySeek
    if (explicitSeek) {
      previousReplaySeekEpochRef.current = replaySeekEpoch
    }

    if (pausedTransition) {
      resetPlaybackClock(playbackClock, videoLapTimeSeconds)
    }

    if (waitingForSeek) playbackClock.didSeek = false
    const synchronizedLapTimeSeconds = waitingForSeek
      ? playbackClock.lapTimeSeconds
      : advancePlaybackClock(playbackClock, {
          videoLapTimeSeconds,
          isPlaying: mediaPlaying,
          explicitSeek,
        })
    const lapTimeSeconds = drivingLineComparisonVehicleTime(
      synchronizedLapTimeSeconds,
      lapWindow.lapDurationSeconds,
      vehicleTimeOffsetSeconds,
    )
    const didSeek = playbackClock.didSeek

    const routeChanged = previousReplayRouteRef.current !== replayRoute
    if (routeChanged) {
      previousReplayRouteRef.current = replayRoute
      lastReplayPoseRef.current = null
    }

    const routeTimeMs = routeTimeMsAtLapTime(lapTimeSeconds)
    let corridorSample = replayRoute?.corridorSample?.(routeTimeMs) ?? null
    const driveInput = calibrationDriveInputRef?.current
    const driveState = calibrationDriveStateRef.current
    let driveActive = Boolean(
      driveInput?.active &&
      // Starting a take seeks the real onboard ahead by the preview lead. Do
      // not consume the new drive session until that deliberate seek settles,
      // or its eventual acknowledgement looks like a mid-take discontinuity
      // and immediately cancels the recording.
      !waitingForSeek &&
      corridorSample &&
      replayRoute?.sampleProgressAtOffset &&
      lapTimeSeconds >= 0 &&
      lapTimeSeconds <= durationMs / 1000,
    )
    let routeSampleOverride: ReplayMotionSample | null = null
    let driveSample: CalibrationDriveSample | null = null

    if (driveActive && driveInput && corridorSample && replayRoute) {
      let newSession = false
      if (driveState.sessionId !== driveInput.sessionId) {
        newSession = true
        driveState.sessionId = driveInput.sessionId
        driveState.offsetMeters = Math.min(
          corridorSample.maximumOffsetMeters,
          Math.max(
            corridorSample.minimumOffsetMeters,
            typeof driveInput.initialOffsetMeters === 'number'
              ? driveInput.initialOffsetMeters
              : corridorSample.offsetMeters,
          ),
        )
        driveState.previousFrameProgress = corridorSample.routeProgress
        driveState.lastCapturedProgress = null
        driveState.lastCapturedOffset = null
        driveState.lastDirection = 0
      }

      const previousProgress = driveState.previousFrameProgress
      const progressStep =
        newSession || pausedTransition || previousProgress === null
          ? 0
          : forwardProgressDistance(
              previousProgress,
              corridorSample.routeProgress,
            )
      const discontinuity =
        !newSession &&
        !pausedTransition &&
        (didSeek ||
          progressStep > CALIBRATION_MAXIMUM_FORWARD_PROGRESS_STEP)

      if (discontinuity) {
        driveActive = false
        driveState.previousFrameProgress = null
        onCalibrationDriveDiscontinuity?.()
      } else {
        driveState.previousFrameProgress = corridorSample.routeProgress
        const travelledMeters =
          progressStep * corridorSample.curveLengthMeters
        const requestedOffset =
          driveState.offsetMeters +
          driveInput.direction *
            CALIBRATION_LATERAL_SPEED_METERS_PER_SECOND *
            frameDelta
        const maximumLateralChange =
          REPLAY_TRACK_CORRIDOR_MAX_LATERAL_SLOPE * travelledMeters
        const slopeLimitedOffset = Math.min(
          driveState.offsetMeters + maximumLateralChange,
          Math.max(
            driveState.offsetMeters - maximumLateralChange,
            requestedOffset,
          ),
        )
        const liveOffset = Math.min(
          corridorSample.maximumOffsetMeters,
          Math.max(corridorSample.minimumOffsetMeters, slopeLimitedOffset),
        )
        const boundaryLimited =
          driveInput.direction !== 0 &&
          Math.abs(liveOffset - slopeLimitedOffset) > 1e-6
        driveState.offsetMeters = liveOffset
        const width =
          corridorSample.maximumOffsetMeters -
          corridorSample.minimumOffsetMeters
        corridorSample = {
          ...corridorSample,
          offsetMeters: liveOffset,
          deltaMeters: liveOffset - corridorSample.guideOffsetMeters,
          roadFraction:
            width > 1e-9
              ? (liveOffset - corridorSample.minimumOffsetMeters) / width
              : 0.5,
          boundaryLimited,
        }
        routeSampleOverride =
          replayRoute.sampleProgressAtOffset?.(
            corridorSample.routeProgress,
            liveOffset,
          ) ?? null
        driveSample = {
          lapTimeSeconds,
          routeProgress: corridorSample.routeProgress,
          offsetMeters: corridorSample.offsetMeters,
          minimumOffsetMeters: corridorSample.minimumOffsetMeters,
          maximumOffsetMeters: corridorSample.maximumOffsetMeters,
          roadFraction: corridorSample.roadFraction,
          boundaryLimited: corridorSample.boundaryLimited,
        }
      }
    }

    const previewOffset = driveInput?.previewOffsetMeters
    const previewingCalibrationEntry =
      !driveActive &&
      typeof previewOffset === 'number' &&
      corridorSample !== null &&
      Boolean(replayRoute?.sampleProgressAtOffset)
    if (previewingCalibrationEntry && corridorSample && replayRoute) {
      const offsetMeters = Math.min(
        corridorSample.maximumOffsetMeters,
        Math.max(corridorSample.minimumOffsetMeters, previewOffset),
      )
      const width =
        corridorSample.maximumOffsetMeters - corridorSample.minimumOffsetMeters
      corridorSample = {
        ...corridorSample,
        offsetMeters,
        deltaMeters: offsetMeters - corridorSample.guideOffsetMeters,
        roadFraction:
          width > 1e-9
            ? (offsetMeters - corridorSample.minimumOffsetMeters) / width
            : 0.5,
        boundaryLimited: false,
      }
      routeSampleOverride =
        replayRoute.sampleProgressAtOffset?.(
          corridorSample.routeProgress,
          offsetMeters,
        ) ?? null
    }

    const pose = replay
      ? resolveReplayCarPose(
          driveableProjector,
          replay.location,
          routeTimeMs,
          lastReplayPoseRef.current ?? spawnPose,
          durationMs,
          replayRoute?.corridorDiagnostics ? 0 : REPLAY_LATERAL_NUDGE,
          smoothMotion,
          replayRoute,
          routeSampleOverride,
        )
      : spawnPose
    if (replay && pose.source === 'replay-location') {
      lastReplayPoseRef.current = pose
    }

    const snapPose =
      !smoothMotion ||
      !cameraReadyRef.current ||
      routeChanged ||
      didSeek ||
      pausedTransition ||
      driveActive ||
      previewingCalibrationEntry
    const smoothedPose = smoothedPoseRef.current
    applySmoothedPose(smoothedPose, pose, deltaSeconds, snapPose)
    if (snapPose) {
      cameraReadyRef.current = true
    }

    carRoot.position.copy(smoothedPose.position)
    carRoot.quaternion.copy(smoothedPose.quaternion)
    carRoot.updateMatrixWorld(true)
    sun.position.copy(smoothedPose.position)

    const cameraBasis = cameraBasisRef.current
    cameraBasis.forward.copy(smoothedPose.forward)
    cameraBasis.right.copy(smoothedPose.right)
    cameraBasis.up.copy(smoothedPose.up)

    const cameraTarget = cameraTargetRef.current.copy(smoothedPose.position)
    const targetFov = cameraMode === 'onboard' ? onboardRig.fov : CAMERA_FOV
    if (camera.fov !== targetFov) {
      camera.fov = targetFov
      camera.updateProjectionMatrix()
    }
    if (cameraMode === 'overhead') {
      const cameraHeight =
        overheadCameraHeightMeters ??
        calibrationCameraHeightRef?.current ??
        OVERHEAD_CAMERA_HEIGHT
      camera.position
        .copy(smoothedPose.position)
        .addScaledVector(cameraBasis.up, cameraHeight)
      cameraTarget.addScaledVector(cameraBasis.forward, CAMERA_TARGET_FORWARD)
      camera.up.copy(cameraBasis.forward)
      camera.lookAt(cameraTarget)
    } else if (cameraMode === 'chase') {
      camera.position
        .copy(smoothedPose.position)
        .addScaledVector(cameraBasis.forward, -CHASE_DISTANCE)
        .addScaledVector(cameraBasis.up, CHASE_HEIGHT)
        .addScaledVector(cameraBasis.right, CHASE_LATERAL_OFFSET)
      cameraTarget
        .addScaledVector(cameraBasis.up, CAMERA_TARGET_HEIGHT)
        .addScaledVector(cameraBasis.forward, CAMERA_TARGET_FORWARD)
      camera.up.copy(cameraBasis.up)
      camera.lookAt(cameraTarget)
    } else {
      // Mount in car-local space (matches W14 GLB +Z nose) so T-cam stays
      // locked to the airbox even if smoothed heading drifts from quaternion.
      const worldPos = onboardWorldPosRef.current.set(
        ONBOARD_CAMERA_LATERAL,
        onboardRig.height,
        -onboardRig.back,
      )
      carRoot.localToWorld(worldPos)
      camera.position.copy(worldPos)
      cameraTarget.set(
        ONBOARD_CAMERA_LATERAL,
        onboardRig.lookHeight,
        onboardRig.lookForward,
      )
      carRoot.localToWorld(cameraTarget)
      camera.up.set(0, 1, 0).applyQuaternion(carRoot.quaternion).normalize()
      camera.lookAt(cameraTarget)
      if (import.meta.env.DEV) {
        const projectLocal = (x: number, y: number, z: number) => {
          const p = onboardProjectRef.current.set(x, y, z)
          carRoot.localToWorld(p)
          p.project(camera)
          return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] as [
            number,
            number,
            number,
          ]
        }
        ;(
          window as Window & {
            __cameraDebug?: {
              local: number[]
              world: number[]
              target: number[]
              mode: SceneCameraMode
              rig: OnboardCameraRig
              ndc: {
                halo: [number, number, number]
                nose: [number, number, number]
                tireL: [number, number, number]
                tireR: [number, number, number]
                wheel: [number, number, number]
              }
            }
          }
        ).__cameraDebug = {
          local: [
            ONBOARD_CAMERA_LATERAL,
            onboardRig.height,
            -onboardRig.back,
          ],
          world: camera.position.toArray(),
          target: cameraTarget.toArray(),
          mode: cameraMode,
          rig: onboardRig,
          // W14 local landmarks for PiP framing checks (NDC: y=-1 bottom, +1 top).
          ndc: {
            halo: projectLocal(0, 0.9, 0.95),
            nose: projectLocal(0, 0.4, 2.6),
            tireL: projectLocal(-0.9, 0.35, 1.85),
            tireR: projectLocal(0.9, 0.35, 1.85),
            wheel: projectLocal(0, 0.55, 1.05),
          },
        }
      }
    }
    camera.updateMatrixWorld()

    motionInstrumenterRef.current?.recordFrame({
      position: smoothedPose.position,
      heading: smoothedPose.forward,
      clockDriftSeconds: videoLapTimeSeconds - lapTimeSeconds,
      corridorSample,
    })

    if (
      driveActive &&
      driveInput &&
      corridorSample &&
      driveSample &&
      onCalibrationDriveSample
    ) {
      const lastProgress = driveState.lastCapturedProgress
      const lastOffset = driveState.lastCapturedOffset
      const movedMeters =
        lastProgress === null
          ? Number.POSITIVE_INFINITY
          : forwardProgressDistance(
              lastProgress,
              corridorSample.routeProgress,
            ) * corridorSample.curveLengthMeters
      const offsetChange =
        lastOffset === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(corridorSample.offsetMeters - lastOffset)
      const directionChanged = driveState.lastDirection !== driveInput.direction
      if (
        movedMeters >= CALIBRATION_CAPTURE_SPACING_METERS ||
        offsetChange >= CALIBRATION_CAPTURE_OFFSET_STEP_METERS ||
        directionChanged
      ) {
        driveState.lastCapturedProgress = corridorSample.routeProgress
        driveState.lastCapturedOffset = corridorSample.offsetMeters
        driveState.lastDirection = driveInput.direction
        onCalibrationDriveSample(driveSample)
      }
    }

    if (driveActive && driveSample) {
      onCalibrationDriveFrame?.(driveSample)
    }

    const sectionEndLapTimeSeconds = driveInput?.sectionEndLapTimeSeconds
    if (
      driveInput?.mode &&
      typeof sectionEndLapTimeSeconds === 'number' &&
      videoLapTimeSeconds >= sectionEndLapTimeSeconds - 0.001 &&
      calibrationSectionEndSessionRef.current !== driveInput.sessionId
    ) {
      calibrationSectionEndSessionRef.current = driveInput.sessionId
      onCalibrationSectionEnd?.(driveInput.mode)
    }

    if (onCalibrationSample && corridorSample) {
      const lastSampleLap = lastCalibrationSampleLapRef.current
      const lastSampleOffset = lastCalibrationSampleOffsetRef.current
      const lastSampleBoundary = lastCalibrationSampleBoundaryRef.current
      const lastSampleAuthoredWeight =
        lastCalibrationSampleAuthoredWeightRef.current
      if (
        lastSampleLap === null ||
        lastSampleOffset === null ||
        lastSampleBoundary === null ||
        lastSampleAuthoredWeight === null ||
        Math.abs(lapTimeSeconds - lastSampleLap) > 0.04 ||
        Math.abs(corridorSample.offsetMeters - lastSampleOffset) > 0.02 ||
        corridorSample.boundaryLimited !== lastSampleBoundary ||
        Math.abs(
          corridorSample.authoredLineWeight - lastSampleAuthoredWeight,
        ) > 0.01 ||
        didSeek ||
        pausedTransition
      ) {
        lastCalibrationSampleLapRef.current = lapTimeSeconds
        lastCalibrationSampleOffsetRef.current = corridorSample.offsetMeters
        lastCalibrationSampleBoundaryRef.current =
          corridorSample.boundaryLimited
        lastCalibrationSampleAuthoredWeightRef.current =
          corridorSample.authoredLineWeight
        onCalibrationSample({
          ...corridorSample,
          calibrationLapTimeSeconds: lapTimeSeconds,
        })
      }
    }

    previousMediaPlayingRef.current = mediaPlaying
  })

  return (
    <>
      <primitive object={track} />
      {replayRoute &&
      (drivingLinePreviewPath?.length || drivingLinePreviewPoints.length > 0) ? (
        <DrivingLinePreview
          route={replayRoute}
          driveableProjector={driveableProjector}
          linePoints={drivingLinePreviewPath ?? drivingLinePreviewPoints}
          marks={drivingLinePreviewPoints}
        />
      ) : null}
      <group ref={carRootRef}>
        <primitive object={car} />
      </group>
      <SunLight ref={sunRef} />
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        fov={onboardRig.fov}
        near={CAMERA_NEAR}
        far={CAMERA_FAR}
      />
    </>
  )
}

useGLTF.preload(TRACK_URL)
useGLTF.preload(CAR_URL)
