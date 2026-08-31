import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { PerspectiveCamera, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { LapWindow } from '../lapWindow'
import { vehicleLapTimeFromPreviewVideoLapTime } from '../calibration/calibrationVideoLead'
import { drivingLineComparisonVehicleTime } from '../calibration/drivingLineComparisonTiming'
import {
  advancePlaybackClock,
  createPlaybackClock,
  resetPlaybackClock,
  type ReplaySeekState,
} from '../playbackClock'
import {
  applySmoothedPose,
  createSmoothedPoseState,
} from './motionSmoothing'
import { MotionInstrumenter } from './motionInstrumentation'
import type { ReplayFile } from '../replay'
import type { RacingLineAnchor } from '../replayDefaults'
import {
  forwardProgressDistance,
  type AuthoredLinePoint,
  type CalibrationDriveInput,
  type CalibrationDriveSample,
} from '../calibration/authoredRacingLine'
import { AUDITED_CURB_CONTACTS } from '../calibration/curbContacts'
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
  CAR_URL,
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
  TRACK_URL,
  isMotionDebugEnabled,
} from './sceneConfig'
import {
  DEFAULT_THIRD_PERSON_ORBIT,
  MINIMUM_THIRD_PERSON_CAMERA_HEIGHT_METERS,
  resolveThirdPersonCamera,
  updateThirdPersonOrbit,
  type CarRelativeCamera,
  type MainCameraMode,
  type ThirdPersonOrbit,
} from './cameraDirector'
import { SunLight } from './SunLight'
import {
  DrivingLinePreview,
  type DrivingLinePreviewPoint,
} from './DrivingLinePreview'
import { configureReplayAssetLoader } from './assetLoader'
import {
  batchStaticCarMeshes,
  createBatchedTrackRender,
  disposeGeneratedBatchedMeshes,
} from './sceneOptimization'

export type SceneCameraMode = 'overhead' | MainCameraMode

const CALIBRATION_LATERAL_SPEED_METERS_PER_SECOND = 2.4
const CALIBRATION_CAPTURE_SPACING_METERS = 1.8
const CALIBRATION_CAPTURE_OFFSET_STEP_METERS = 0.04
const CALIBRATION_MAXIMUM_FORWARD_PROGRESS_STEP = 0.01
// Video time updates re-render App. Keep this dependency stable so the
// 4,096-point projected driving-line geometry is not rebuilt each time.
const EMPTY_DRIVING_LINE_PREVIEW_POINTS: readonly DrivingLinePreviewPoint[] = []

type OwnedSceneResources = {
  roots: readonly THREE.Object3D[]
  materials: readonly THREE.Material[]
}

const ACTIVE_SCENE_RESOURCES = new WeakSet<OwnedSceneResources>()
const DISPOSED_SCENE_RESOURCES = new WeakSet<OwnedSceneResources>()

/**
 * Release optimizer-owned GPU allocations after a real unmount or resource
 * replacement. The microtask lease keeps React development Strict Mode's
 * setup -> cleanup -> setup probe from disposing resources still in use.
 */
function useOwnedSceneResourceCleanup(resources: OwnedSceneResources) {
  useEffect(() => {
    ACTIVE_SCENE_RESOURCES.add(resources)

    return () => {
      ACTIVE_SCENE_RESOURCES.delete(resources)
      queueMicrotask(() => {
        if (
          ACTIVE_SCENE_RESOURCES.has(resources) ||
          DISPOSED_SCENE_RESOURCES.has(resources)
        ) {
          return
        }

        DISPOSED_SCENE_RESOURCES.add(resources)
        for (const root of resources.roots) {
          disposeGeneratedBatchedMeshes(root)
        }
        for (const material of resources.materials) material.dispose()
      })
    }
  }, [resources])
}

function routeTimeMsAtLapTime(lapTimeSeconds: number) {
  return lapTimeSeconds * 1000 + REPLAY_START_ROUTE_TIME_MS
}

export type OnboardCameraRig = {
  back: number
  height: number
  lookHeight: number
  lookForward: number
  fov: number
}

function resolveCameraMode(): SceneCameraMode {
  const search = new URLSearchParams(window.location.search)
  const requestedCamera = search.get('camera')
  if (requestedCamera === 'overhead') {
    return 'overhead'
  }
  if (requestedCamera === 'onboard' || requestedCamera === 'tv-pod') {
    return 'onboard'
  }
  // Preserve the previous debug URL while exposing the product name in the UI.
  if (requestedCamera === 'chase' || requestedCamera === 'third-person') {
    return 'third-person'
  }
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
  replaySeekRef?: RefObject<ReplaySeekState>
  videoPreviewLeadSeconds?: number
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
  shadowMapSize: number
}

type CameraBasis = {
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
}

function applyCarRelativeCamera(
  camera: THREE.PerspectiveCamera,
  origin: THREE.Vector3,
  basis: CameraBasis,
  definition: CarRelativeCamera,
  target: THREE.Vector3,
) {
  camera.position
    .copy(origin)
    .addScaledVector(basis.right, definition.position.right)
    .addScaledVector(basis.up, definition.position.up)
    .addScaledVector(basis.forward, definition.position.forward)
  target
    .copy(origin)
    .addScaledVector(basis.right, definition.target.right)
    .addScaledVector(basis.up, definition.target.up)
    .addScaledVector(basis.forward, definition.target.forward)
  camera.up.copy(basis.up)
  camera.lookAt(target)
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

function prepareCar(scene: THREE.Group): {
  root: THREE.Group
  ownedMaterials: THREE.Material[]
} {
  const root = scene.clone(true)
  const tunedMaterials = new WeakMap<THREE.Material, THREE.Material>()
  const ownedMaterials = new Set<THREE.Material>()

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
      } else if (/mercedes_paint_nose/.test(name)) {
        // W15 muted aluminium — must not inherit body clearcoat or it reads white.
        // Keep the runtime factor aligned with the Blender-authored, app-verified
        // cool silver so it does not drift warmer/darker after GLTF loading.
        material.color.set('#768188')
        material.metalness = 0.38
        material.roughness = 0.56
        material.envMapIntensity = 0.4
        if (material instanceof THREE.MeshPhysicalMaterial) {
          material.clearcoat = 0
          material.clearcoatRoughness = 0.5
        }
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
    ownedMaterials.add(material)
    return material
  }

  // `camera_wing` is authored as a Group in the current W14. Hide every
  // descendant before batching so generic child mesh names cannot be lifted
  // back into the visible render root.
  root.traverse((object) => {
    if (!/camera_wing/i.test(object.name)) return
    object.traverse((descendant) => {
      descendant.visible = false
    })
  })

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return
    object.castShadow = true
    object.receiveShadow = true
    object.material = Array.isArray(object.material)
      ? object.material.map(tuneMaterial)
      : tuneMaterial(object.material)
  })
  return { root, ownedMaterials: [...ownedMaterials] }
}

export function LapModels({
  replay,
  playheadSeconds,
  videoRef,
  lapWindow,
  racingLineAnchors,
  authoredLinePoints,
  drivingLinePreviewPath,
  drivingLinePreviewPoints = EMPTY_DRIVING_LINE_PREVIEW_POINTS,
  replaySeekRef,
  videoPreviewLeadSeconds = 0,
  vehicleTimeOffsetSeconds = 0,
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
  shadowMapSize,
}: LapModelsProps) {
  const renderer = useThree((state) => state.gl)
  const configureAssetLoader = useMemo(
    () => configureReplayAssetLoader(renderer),
    [renderer],
  )
  const [trackGltf, carGltf] = useGLTF(
    [TRACK_URL, CAR_URL],
    false,
    true,
    configureAssetLoader,
  )
  const carRootRef = useRef<THREE.Group>(null)
  const sunRef = useRef<THREE.Group>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const cameraReadyRef = useRef(false)
  const thirdPersonOrbitRef = useRef<ThirdPersonOrbit>(
    DEFAULT_THIRD_PERSON_ORBIT,
  )
  const thirdPersonDragRef = useRef({
    pointerId: null as number | null,
    clientX: 0,
    clientY: 0,
  })
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

  const sceneOptimizationEnabled = useMemo(
    () =>
      !import.meta.env.DEV ||
      new URLSearchParams(window.location.search).get('scene-opt') !== 'off',
    [],
  )
  const track = useMemo(() => prepareTrack(trackGltf.scene), [trackGltf.scene])
  const trackRender = useMemo(
    () =>
      sceneOptimizationEnabled
        ? createBatchedTrackRender(track)
        : { root: track, stats: null },
    [sceneOptimizationEnabled, track],
  )
  const preparedCar = useMemo(() => {
    const { root, ownedMaterials } = prepareCar(carGltf.scene)
    return {
      root,
      ownedMaterials,
      stats: sceneOptimizationEnabled ? batchStaticCarMeshes(root) : null,
    }
  }, [carGltf.scene, sceneOptimizationEnabled])
  const car = preparedCar.root
  const ownedSceneResources = useMemo<OwnedSceneResources>(
    () => ({
      roots: [trackRender.root, preparedCar.root],
      materials: preparedCar.ownedMaterials,
    }),
    [preparedCar, trackRender.root],
  )
  useOwnedSceneResourceCleanup(ownedSceneResources)
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
  const cameraDebug = useMemo(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get('camera-debug') === '1',
    [],
  )
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
        __sceneOptimization?: {
          track: typeof trackRender.stats
          car: typeof preparedCar.stats
        }
      }
    ).__sceneOptimization = {
      track: trackRender.stats,
      car: preparedCar.stats,
    }
  }, [preparedCar.stats, trackRender.stats])

  useEffect(() => {
    if (typeof thirdPersonResetKey !== 'number') return
    thirdPersonOrbitRef.current = DEFAULT_THIRD_PERSON_ORBIT
    invalidate()
  }, [invalidate, thirdPersonResetKey])

  // These values are consumed inside useFrame rather than attached as host
  // object props. In demand mode, invalidate after React commits so a paused
  // camera/quality/control change renders with the new closure immediately.
  useEffect(() => {
    invalidate()
  }, [
    cameraMode,
    invalidate,
    overheadCameraHeightMeters,
    vehicleTimeOffsetSeconds,
    videoPreviewLeadSeconds,
  ])

  useEffect(() => {
    if (cameraMode !== 'third-person') return

    const canvas = renderer.domElement
    const drag = thirdPersonDragRef.current

    const endDrag = (event?: PointerEvent) => {
      if (
        typeof drag.pointerId === 'number' &&
        canvas.hasPointerCapture(drag.pointerId)
      ) {
        canvas.releasePointerCapture(drag.pointerId)
      }
      if (!event || event.pointerId === drag.pointerId) {
        drag.pointerId = null
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return
      drag.pointerId = event.pointerId
      drag.clientX = event.clientX
      drag.clientY = event.clientY
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return
      const deltaX = event.clientX - drag.clientX
      const deltaY = event.clientY - drag.clientY
      drag.clientX = event.clientX
      drag.clientY = event.clientY
      thirdPersonOrbitRef.current = updateThirdPersonOrbit(
        thirdPersonOrbitRef.current,
        {
          yawRadians: -deltaX * 0.008,
          pitchRadians: -deltaY * 0.006,
        },
      )
      invalidate()
      event.preventDefault()
    }

    const onWheel = (event: WheelEvent) => {
      thirdPersonOrbitRef.current = updateThirdPersonOrbit(
        thirdPersonOrbitRef.current,
        { distanceMeters: event.deltaY * 0.012 },
      )
      invalidate()
      event.preventDefault()
    }

    const onDoubleClick = (event: MouseEvent) => {
      thirdPersonOrbitRef.current = DEFAULT_THIRD_PERSON_ORBIT
      invalidate()
      event.preventDefault()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDoubleClick)
    return () => {
      endDrag()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDoubleClick)
    }
  }, [cameraMode, invalidate, renderer])

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
  }, [replayRoute])

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

  // A paused scrub can render once while the media element is still seeking.
  // Demand mode needs a second frame after the seek settles so the pending
  // replay epoch is consumed and the 3D pose snaps to the decoded video time.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleSeeked = () => invalidate()
    video.addEventListener('seeked', handleSeeked)
    return () => video.removeEventListener('seeked', handleSeeked)
  }, [invalidate, videoRef])

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
          deltaSeconds: frameDelta,
          videoLapTimeSeconds,
          isPlaying: mediaPlaying,
          playbackRate: video?.playbackRate ?? 1,
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

    const driveInput = calibrationDriveInputRef?.current
    const routeTimeMs = routeTimeMsAtLapTime(lapTimeSeconds)
    const needsCorridorSample = Boolean(
      driveInput || onCalibrationSample || motionInstrumenterRef.current,
    )
    let corridorSample = needsCorridorSample
      ? replayRoute?.corridorSample?.(routeTimeMs) ?? null
      : null
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
    applySmoothedPose(smoothedPose, pose, frameDelta, snapPose)
    if (snapPose) {
      cameraReadyRef.current = true
    }

    carRoot.position.copy(smoothedPose.position)
    carRoot.quaternion.copy(smoothedPose.quaternion)
    sun.position.copy(smoothedPose.position)

    const cameraBasis = cameraBasisRef.current
    cameraBasis.forward.copy(smoothedPose.forward)
    cameraBasis.right.copy(smoothedPose.right)
    cameraBasis.up.copy(smoothedPose.up)

    const cameraTarget = cameraTargetRef.current.copy(smoothedPose.position)
    const thirdPersonCamera =
      cameraMode === 'third-person'
        ? resolveThirdPersonCamera(thirdPersonOrbitRef.current)
        : null
    const targetFov =
      cameraMode === 'onboard'
        ? onboardRig.fov
        : thirdPersonCamera?.fovDegrees ?? CAMERA_FOV
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
    } else if (thirdPersonCamera) {
      applyCarRelativeCamera(
        camera,
        smoothedPose.position,
        cameraBasis,
        thirdPersonCamera,
        cameraTarget,
      )
      const minimumCameraY =
        smoothedPose.position.y +
        MINIMUM_THIRD_PERSON_CAMERA_HEIGHT_METERS
      if (camera.position.y < minimumCameraY) {
        camera.position.y = minimumCameraY
        camera.lookAt(cameraTarget)
      }
    } else {
      // Mount in car-local space (matches W14 GLB +Z nose) so T-cam stays
      // locked to the airbox even if smoothed heading drifts from quaternion.
      const worldPos = onboardWorldPosRef.current.set(
        ONBOARD_CAMERA_LATERAL,
        onboardRig.height,
        -onboardRig.back,
      )
      worldPos.applyQuaternion(carRoot.quaternion).add(carRoot.position)
      camera.position.copy(worldPos)
      cameraTarget.set(
        ONBOARD_CAMERA_LATERAL,
        onboardRig.lookHeight,
        onboardRig.lookForward,
      )
      cameraTarget.applyQuaternion(carRoot.quaternion).add(carRoot.position)
      camera.up.set(0, 1, 0).applyQuaternion(carRoot.quaternion).normalize()
      camera.lookAt(cameraTarget)
      if (cameraDebug) {
        const projectLocal = (x: number, y: number, z: number) => {
          const p = onboardProjectRef.current.set(x, y, z)
          p.applyQuaternion(carRoot.quaternion).add(carRoot.position)
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
      <primitive object={trackRender.root} />
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
      <SunLight ref={sunRef} shadowMapSize={shadowMapSize} />
      <PerspectiveCamera
        ref={cameraRef}
        makeDefault
        fov={CAMERA_FOV}
        near={CAMERA_NEAR}
        far={CAMERA_FAR}
      />
    </>
  )
}
