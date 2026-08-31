import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import appStyles from '../ReplayPage.module.css'
import { NavBar } from '../components/NavBar'
import { OnboardVideo } from '../components/OnboardVideo'
import { Playhead } from '../components/Playhead'
import { TrackScene } from '../scene/TrackScene'
import {
  DrivingLineLabPanel,
  type DrivingLineLabSaveState,
} from './DrivingLineLabPanel'
import type { ReplayCorridorSample } from '../scene/replayMotion'
import {
  CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  clampCalibrationCameraHeight,
} from './calibrationCamera'
import {
  viewerDeltaToRouteDelta,
  viewerDirectionToRouteDirection,
  viewerRoadFraction,
} from './calibrationControls'
import {
  type CalibrationDriveInput,
  type CalibrationDriveSample,
} from './authoredRacingLine'
import {
  addDrivingLineContactSlot,
  addDrivingLineMarkWithUndo,
  appendDrivingLineRun,
  readStoredDrivingLineLab,
  removeDrivingLineContactSlot,
  restoreDrivingLineMarkUndo,
  selectDrivingLineRun,
  selectedDrivingLineRun,
  serializeDrivingLineRun,
  storeDrivingLineLab,
  undoLastDrivingLineMark,
  type DrivingLineContactSlot,
  type DrivingLineMarkUndo,
  type DrivingLineRun,
  type DrivingLineSurface,
} from './drivingLineLab'
import {
  DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS,
  drivingLineSourceVideoTimeFromVehicleLapTime,
  drivingLineVideoLeadForCameraView,
  drivingLineVehicleLapTimeFromPreviewLapTime,
} from './drivingLineLabClock'
import {
  clampDrivingLineComparisonOffset,
  drivingLineComparisonVehicleTime,
  readStoredDrivingLineComparisonOffset,
  storeDrivingLineComparisonOffset,
} from './drivingLineComparisonTiming'
import {
  clampLapTime,
  ONBOARD_LAP_START_SECONDS,
  type LapWindow,
} from '../lapWindow'
import type { ReplaySeekState } from '../playbackClock'
import { loadReplay } from '../replay'
import {
  DEFAULT_RACING_LINE_ANCHORS,
  DEFAULT_REPLAY_DURATION_SECONDS,
} from '../replayDefaults'
import {
  flattenSectionLineTakes,
  readStoredSectionRacingLine,
} from './sectionRacingLine'

const DEFAULT_PLAYBACK_RATE = 0.1
const BACKWARD_STEP_BASE_SECONDS = 0.1
const PAUSED_LATERAL_STEP_METERS = 0.16
const VIDEO_LEAD_SECONDS = DRIVING_LINE_LAB_VIDEO_LEAD_SECONDS
const SAMPLE_MATCH_TOLERANCE_SECONDS = 0.035

type PendingContactNavigation = {
  epoch: number
  runId: string
  contactSlot: DrivingLineContactSlot
  markId: string
  targetLapTimeSeconds: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function firstAvailableContactSlot(
  run: DrivingLineRun,
): DrivingLineContactSlot {
  const occupiedSlots = new Set(run.marks.map((mark) => mark.contactSlot))
  for (
    let slot = 1;
    slot <= run.contactSlotCount;
    slot += 1
  ) {
    if (!occupiedSlots.has(slot as DrivingLineContactSlot)) {
      return slot as DrivingLineContactSlot
    }
  }
  return 1
}

function preservesNativeKeyboardControl(event: KeyboardEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true
  if (target instanceof HTMLInputElement) {
    if (target.type !== 'range') return true
    return [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(event.code)
  }
  if (target instanceof HTMLSelectElement) {
    return [
      'Space',
      'Enter',
      'Escape',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(event.code)
  }
  return (
    (event.code === 'Space' || event.code === 'Enter') &&
    target.closest('button') !== null
  )
}

export default function DrivingLineLabPage() {
  const [durationSeconds, setDurationSeconds] = useState(
    DEFAULT_REPLAY_DURATION_SECONDS,
  )
  const [playheadSeconds, setPlayheadSeconds] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_PLAYBACK_RATE)
  const [videoReady, setVideoReady] = useState(false)
  const [replay, setReplay] = useState<Awaited<
    ReturnType<typeof loadReplay>
  > | null>(null)
  const [cameraView, setCameraView] = useState<'overhead' | 'onboard'>(
    'overhead',
  )
  const [cameraHeightMeters, setCameraHeightMeters] = useState(
    CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  )
  const [comparisonOffsetSeconds, setComparisonOffsetSeconds] = useState(
    readStoredDrivingLineComparisonOffset,
  )
  const [surface, setSurface] =
    useState<DrivingLineSurface>('white-line')
  const [labDocument, setLabDocument] = useState(readStoredDrivingLineLab)
  const initialContactSlot = firstAvailableContactSlot(
    selectedDrivingLineRun(labDocument),
  )
  const [selectedContactSlot, setSelectedContactSlot] =
    useState<DrivingLineContactSlot>(initialContactSlot)
  const [focusedContactMarkId, setFocusedContactMarkId] = useState<
    string | null
  >(null)
  const [undoAvailable, setUndoAvailable] = useState(
    () => selectedDrivingLineRun(labDocument).marks.length > 0,
  )
  const [contactNavigationPending, setContactNavigationPending] =
    useState(false)
  const [corridorSample, setCorridorSample] =
    useState<ReplayCorridorSample | null>(null)
  const [sceneRenderEpoch, setSceneRenderEpoch] = useState(0)
  const [saveState, setSaveState] = useState<DrivingLineLabSaveState>({
    status: 'idle',
  })
  const [acceptedLinePoints] = useState(() =>
    flattenSectionLineTakes(readStoredSectionRacingLine()),
  )

  const labDocumentRef = useRef(labDocument)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playheadRef = useRef(0)
  const replaySeekRef = useRef<ReplaySeekState>({
    seekEpoch: 0,
    pendingLapTimeSeconds: null,
  })
  const manualDriveInputRef = useRef<CalibrationDriveInput>({
    active: false,
    direction: 0,
    sessionId: 0,
    initialOffsetMeters: null,
    previewOffsetMeters: null,
    sectionEndLapTimeSeconds: null,
    mode: null,
  })
  const driveInitializedRef = useRef(false)
  const videoInitializedRef = useRef(false)
  const latestCorridorSampleRef = useRef<ReplayCorridorSample | null>(null)
  const latestDriveFrameRef = useRef<CalibrationDriveSample | null>(null)
  const pressedLateralKeysRef = useRef(new Set<string>())
  const forwardKeysRef = useRef(new Set<string>())
  const pointerLateralDirectionRef = useRef<-1 | 0 | 1>(0)
  const persistentPlaybackRef = useRef(false)
  const videoLeadSecondsRef = useRef(VIDEO_LEAD_SECONDS)
  const comparisonOffsetSecondsRef = useRef(comparisonOffsetSeconds)
  const vehicleTimeOffsetSecondsRef = useRef(0)
  const surfaceRef = useRef<DrivingLineSurface>('white-line')
  const activeRunIdRef = useRef(labDocument.selectedRunId)
  const selectedContactSlotRef =
    useRef<DrivingLineContactSlot>(initialContactSlot)
  const focusedContactMarkIdRef = useRef<string | null>(null)
  const contactSlotByRunRef = useRef(
    new Map<string, DrivingLineContactSlot>([
      [labDocument.selectedRunId, initialContactSlot],
    ]),
  )
  const contactNavigationEpochRef = useRef(0)
  const pendingContactNavigationRef =
    useRef<PendingContactNavigation | null>(null)
  const markUndoHistoryRef = useRef(
    new Map<string, DrivingLineMarkUndo[]>(),
  )
  const saveRequestEpochRef = useRef(0)

  const lapWindow = useMemo<LapWindow>(
    () => ({
      videoStartSeconds: ONBOARD_LAP_START_SECONDS,
      lapDurationSeconds: durationSeconds,
    }),
    [durationSeconds],
  )
  const selectedRun = selectedDrivingLineRun(labDocument)
  const selectedContactMark = selectedRun.marks.find(
    (mark) => mark.contactSlot === selectedContactSlot,
  )
  const selectedContactIsFocused =
    !selectedContactMark || selectedContactMark.id === focusedContactMarkId
  const activeVideoLeadSeconds = drivingLineVideoLeadForCameraView(cameraView)
  const activeComparisonOffsetSeconds =
    cameraView === 'onboard' ? comparisonOffsetSeconds : 0
  const effectivePlayheadSeconds = drivingLineComparisonVehicleTime(
    playheadSeconds,
    durationSeconds,
    activeComparisonOffsetSeconds,
  )
  const sampleAtPlayhead = Boolean(
    selectedContactIsFocused &&
    !contactNavigationPending &&
      corridorSample &&
      typeof corridorSample.calibrationLapTimeSeconds === 'number' &&
      Math.abs(
        corridorSample.calibrationLapTimeSeconds - effectivePlayheadSeconds,
      ) <= SAMPLE_MATCH_TOLERANCE_SECONDS,
  )
  const previewPoints = selectedRun.marks

  useEffect(() => {
    let cancelled = false
    void loadReplay()
      .then((loadedReplay) => {
        if (cancelled) return
        setReplay(loadedReplay)
        if (
          typeof loadedReplay.lap.lap_duration === 'number' &&
          Number.isFinite(loadedReplay.lap.lap_duration)
        ) {
          setDurationSeconds(loadedReplay.lap.lap_duration)
        }
      })
      .catch((error: unknown) => {
        console.warn(
          '[driving-line-lab] replay cache unavailable; using static pose',
          error,
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    storeDrivingLineLab(labDocument)
  }, [labDocument])

  useEffect(() => {
    storeDrivingLineComparisonOffset(comparisonOffsetSeconds)
  }, [comparisonOffsetSeconds])

  useEffect(
    () => () => {
      saveRequestEpochRef.current += 1
    },
    [],
  )

  const invalidateSaveState = useCallback(() => {
    saveRequestEpochRef.current += 1
    setSaveState({ status: 'idle' })
  }, [])

  const replaceLabDocument = useCallback(
    (nextDocument: typeof labDocument) => {
      labDocumentRef.current = nextDocument
      setLabDocument(nextDocument)
    },
    [],
  )

  const markReplaySeek = useCallback((lapTimeSeconds: number) => {
    replaySeekRef.current.seekEpoch += 1
    replaySeekRef.current.pendingLapTimeSeconds = lapTimeSeconds
  }, [])

  const cancelPendingContactNavigation = useCallback(() => {
    contactNavigationEpochRef.current += 1
    pendingContactNavigationRef.current = null
    setContactNavigationPending(false)
  }, [])

  const comparisonVehicleTime = useCallback(
    (videoLapTimeSeconds: number) =>
      drivingLineComparisonVehicleTime(
        videoLapTimeSeconds,
        durationSeconds,
        vehicleTimeOffsetSecondsRef.current,
      ),
    [durationSeconds],
  )

  const seekVehicleTime = useCallback(
    (seconds: number, videoLeadSeconds = videoLeadSecondsRef.current) => {
      if (!videoReady) return
      const next = clampLapTime(seconds, durationSeconds)
      latestCorridorSampleRef.current = null
      latestDriveFrameRef.current = null
      setCorridorSample(null)
      playheadRef.current = next
      setPlayheadSeconds(next)
      const video = videoRef.current
      if (video) {
        markReplaySeek(next)
        video.currentTime = drivingLineSourceVideoTimeFromVehicleLapTime(
          next,
          lapWindow,
          videoLeadSeconds,
        )
      }
    },
    [durationSeconds, lapWindow, markReplaySeek, videoReady],
  )

  useEffect(() => {
    if (!videoReady || videoInitializedRef.current) return
    videoInitializedRef.current = true
    seekVehicleTime(
      pendingContactNavigationRef.current?.targetLapTimeSeconds ?? 0,
    )
  }, [seekVehicleTime, videoReady])

  const handleLapTimeUpdate = useCallback(
    (previewLapTimeSeconds: number) => {
      const next = drivingLineVehicleLapTimeFromPreviewLapTime(
        previewLapTimeSeconds,
        lapWindow.lapDurationSeconds,
        videoLeadSecondsRef.current,
      )
      playheadRef.current = next
      setPlayheadSeconds(next)
    },
    [lapWindow],
  )

  const pauseVideo = useCallback(() => {
    videoRef.current?.pause()
    setPlaying(false)
  }, [])

  const startVideo = useCallback(() => {
    const video = videoRef.current
    if (!videoReady || !video) return
    const activeLeadSeconds = videoLeadSecondsRef.current
    const endSourceTime =
      lapWindow.videoStartSeconds +
      lapWindow.lapDurationSeconds +
      activeLeadSeconds
    if (
      playheadRef.current >= durationSeconds - 0.001 ||
      video.currentTime >= endSourceTime - 0.001
    ) {
      const startSourceTime = drivingLineSourceVideoTimeFromVehicleLapTime(
        0,
        lapWindow,
        activeLeadSeconds,
      )
      markReplaySeek(0)
      video.currentTime = startSourceTime
      playheadRef.current = 0
      setPlayheadSeconds(0)
    }
    video.playbackRate = playbackRate
    void video.play().catch(() => setPlaying(false))
  }, [durationSeconds, lapWindow, markReplaySeek, playbackRate, videoReady])

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!videoReady || !video) return
    if (video.paused) {
      cancelPendingContactNavigation()
      persistentPlaybackRef.current = true
      startVideo()
    } else {
      persistentPlaybackRef.current = false
      pauseVideo()
    }
  }, [cancelPendingContactNavigation, pauseVideo, startVideo, videoReady])

  const handlePlayState = useCallback((nextPlaying: boolean) => {
    if (
      nextPlaying &&
      forwardKeysRef.current.size === 0 &&
      !persistentPlaybackRef.current
    ) {
      videoRef.current?.pause()
      setPlaying(false)
      return
    }
    setPlaying(nextPlaying)
    if (!nextPlaying && forwardKeysRef.current.size === 0) {
      persistentPlaybackRef.current = false
    }
  }, [])

  const refreshLateralDirection = useCallback(() => {
    const pressed = pressedLateralKeysRef.current
    const pointerDirection = pointerLateralDirectionRef.current
    const left =
      pointerDirection === -1 ||
      pressed.has('KeyA') ||
      pressed.has('ArrowLeft')
    const right =
      pointerDirection === 1 ||
      pressed.has('KeyD') ||
      pressed.has('ArrowRight')
    manualDriveInputRef.current.direction = viewerDirectionToRouteDirection(
      left === right ? 0 : left ? -1 : 1,
    )
  }, [])

  const releaseLateralControls = useCallback(() => {
    pressedLateralKeysRef.current.clear()
    pointerLateralDirectionRef.current = 0
    manualDriveInputRef.current.direction = 0
  }, [])

  const handleCorridorSample = useCallback((sample: ReplayCorridorSample) => {
    const pendingNavigation = pendingContactNavigationRef.current
    if (pendingNavigation) {
      const matchesLatestRequest =
        pendingNavigation.epoch === contactNavigationEpochRef.current &&
        pendingNavigation.runId === activeRunIdRef.current &&
        pendingNavigation.contactSlot === selectedContactSlotRef.current &&
        pendingNavigation.markId === focusedContactMarkIdRef.current &&
        typeof sample.calibrationLapTimeSeconds === 'number' &&
        Math.abs(
          sample.calibrationLapTimeSeconds -
            comparisonVehicleTime(pendingNavigation.targetLapTimeSeconds),
        ) <= SAMPLE_MATCH_TOLERANCE_SECONDS &&
        !videoRef.current?.seeking
      if (!matchesLatestRequest) return
      pendingContactNavigationRef.current = null
      setContactNavigationPending(false)
    }
    latestCorridorSampleRef.current = sample
    setCorridorSample(sample)
    if (driveInitializedRef.current) return

    driveInitializedRef.current = true
    const driveInput = manualDriveInputRef.current
    driveInput.sessionId += 1
    driveInput.active = true
    driveInput.direction = 0
    driveInput.initialOffsetMeters = sample.offsetMeters
    driveInput.previewOffsetMeters = null
    driveInput.mode = null
  }, [comparisonVehicleTime])

  const handleDriveFrame = useCallback((sample: CalibrationDriveSample) => {
    latestDriveFrameRef.current = sample
  }, [])

  const nudgePausedCar = useCallback((viewerDeltaMeters: number) => {
    const sample = latestCorridorSampleRef.current
    if (
      !sample ||
      typeof sample.calibrationLapTimeSeconds !== 'number' ||
      Math.abs(
        sample.calibrationLapTimeSeconds -
          comparisonVehicleTime(playheadRef.current),
      ) >
        SAMPLE_MATCH_TOLERANCE_SECONDS
    ) {
      return
    }
    const nextOffset = clamp(
      sample.offsetMeters + viewerDeltaToRouteDelta(viewerDeltaMeters),
      sample.minimumOffsetMeters,
      sample.maximumOffsetMeters,
    )
    const width = sample.maximumOffsetMeters - sample.minimumOffsetMeters
    const nextSample: ReplayCorridorSample = {
      ...sample,
      offsetMeters: nextOffset,
      deltaMeters: nextOffset - sample.guideOffsetMeters,
      roadFraction:
        width > 1e-9
          ? (nextOffset - sample.minimumOffsetMeters) / width
          : 0.5,
      boundaryLimited:
        Math.abs(
          nextOffset -
            (sample.offsetMeters + viewerDeltaToRouteDelta(viewerDeltaMeters)),
        ) > 1e-6,
    }
    latestCorridorSampleRef.current = nextSample
    latestDriveFrameRef.current = {
      lapTimeSeconds: comparisonVehicleTime(playheadRef.current),
      routeProgress: nextSample.routeProgress,
      offsetMeters: nextSample.offsetMeters,
      minimumOffsetMeters: nextSample.minimumOffsetMeters,
      maximumOffsetMeters: nextSample.maximumOffsetMeters,
      roadFraction: nextSample.roadFraction,
      boundaryLimited: nextSample.boundaryLimited,
    }
    setCorridorSample(nextSample)

    const driveInput = manualDriveInputRef.current
    driveInput.sessionId += 1
    driveInput.active = true
    driveInput.direction = 0
    driveInput.initialOffsetMeters = nextOffset
    driveInput.previewOffsetMeters = null
    setSceneRenderEpoch((current) => current + 1)
  }, [comparisonVehicleTime])

  const beginForward = useCallback(
    (source: string) => {
      cancelPendingContactNavigation()
      forwardKeysRef.current.add(source)
      startVideo()
    },
    [cancelPendingContactNavigation, startVideo],
  )

  const endForward = useCallback(
    (source: string) => {
      forwardKeysRef.current.delete(source)
      if (
        forwardKeysRef.current.size === 0 &&
        !persistentPlaybackRef.current
      ) {
        pauseVideo()
      }
    },
    [pauseVideo],
  )

  const stepBackward = useCallback(() => {
    cancelPendingContactNavigation()
    persistentPlaybackRef.current = false
    pauseVideo()
    const stepSeconds = Math.max(
      0.04,
      BACKWARD_STEP_BASE_SECONDS * playbackRate,
    )
    seekVehicleTime(playheadRef.current - stepSeconds)
  }, [
    cancelPendingContactNavigation,
    pauseVideo,
    playbackRate,
    seekVehicleTime,
  ])

  const beginLateral = useCallback(
    (direction: -1 | 1, source = 'pointer') => {
      if (playing) {
        if (source === 'pointer') pointerLateralDirectionRef.current = direction
        else pressedLateralKeysRef.current.add(source)
        refreshLateralDirection()
      } else {
        nudgePausedCar(direction * PAUSED_LATERAL_STEP_METERS)
      }
    },
    [nudgePausedCar, playing, refreshLateralDirection],
  )

  const endLateral = useCallback(
    (source = 'pointer') => {
      if (source === 'pointer') pointerLateralDirectionRef.current = 0
      else pressedLateralKeysRef.current.delete(source)
      refreshLateralDirection()
    },
    [refreshLateralDirection],
  )

  const selectSurface = useCallback((nextSurface: DrivingLineSurface) => {
    surfaceRef.current = nextSurface
    setSurface(nextSurface)
  }, [])

  const focusContactSlot = useCallback(
    (run: DrivingLineRun, contactSlot: DrivingLineContactSlot) => {
      const epoch = contactNavigationEpochRef.current + 1
      contactNavigationEpochRef.current = epoch
      pendingContactNavigationRef.current = null
      setContactNavigationPending(false)
      activeRunIdRef.current = run.id
      selectedContactSlotRef.current = contactSlot
      focusedContactMarkIdRef.current = null
      setFocusedContactMarkId(null)
      contactSlotByRunRef.current.set(run.id, contactSlot)
      setSelectedContactSlot(contactSlot)

      persistentPlaybackRef.current = false
      forwardKeysRef.current.clear()
      releaseLateralControls()
      pauseVideo()

      const mark = run.marks.find(
        (candidate) => candidate.contactSlot === contactSlot,
      )
      if (!mark) return

      focusedContactMarkIdRef.current = mark.id
      setFocusedContactMarkId(mark.id)
      selectSurface(mark.surface)
      const driveInput = manualDriveInputRef.current
      driveInput.sessionId += 1
      driveInput.active = true
      driveInput.direction = 0
      driveInput.initialOffsetMeters = mark.offsetMeters
      driveInput.previewOffsetMeters = null
      driveInput.sectionEndLapTimeSeconds = null
      driveInput.mode = null
      pendingContactNavigationRef.current = {
        epoch,
        runId: run.id,
        contactSlot,
        markId: mark.id,
        targetLapTimeSeconds: mark.sourceLapTimeSeconds,
      }
      setContactNavigationPending(true)
      seekVehicleTime(
        mark.sourceLapTimeSeconds,
        videoLeadSecondsRef.current,
      )
    },
    [pauseVideo, releaseLateralControls, seekVehicleTime, selectSurface],
  )

  const markCurrentContact = useCallback(() => {
    if (playing) return
    const corridor = latestCorridorSampleRef.current
    if (
      !corridor ||
      typeof corridor.calibrationLapTimeSeconds !== 'number' ||
      Math.abs(
        corridor.calibrationLapTimeSeconds -
          comparisonVehicleTime(playheadRef.current),
      ) >
        SAMPLE_MATCH_TOLERANCE_SECONDS ||
      Boolean(videoRef.current?.seeking)
    ) {
      return
    }
    const frame = latestDriveFrameRef.current
    const vehicleLapTimeSeconds = comparisonVehicleTime(playheadRef.current)
    const current =
      frame &&
      Math.abs(frame.lapTimeSeconds - vehicleLapTimeSeconds) <=
        SAMPLE_MATCH_TOLERANCE_SECONDS
        ? frame
        : {
            lapTimeSeconds: vehicleLapTimeSeconds,
            routeProgress: corridor.routeProgress,
            offsetMeters: corridor.offsetMeters,
            minimumOffsetMeters: corridor.minimumOffsetMeters,
            maximumOffsetMeters: corridor.maximumOffsetMeters,
            roadFraction: corridor.roadFraction,
            boundaryLimited: corridor.boundaryLimited,
          }
    invalidateSaveState()
    const contactSlot = selectedContactSlotRef.current
    const selectedSurface = surfaceRef.current
    const document = labDocumentRef.current
    if (document.selectedRunId !== activeRunIdRef.current) return
    const result = addDrivingLineMarkWithUndo(document, {
      contactSlot,
      routeProgress: current.routeProgress,
      offsetMeters: current.offsetMeters,
      sourceLapTimeSeconds: playheadRef.current,
      minimumOffsetMeters: current.minimumOffsetMeters,
      maximumOffsetMeters: current.maximumOffsetMeters,
      roadFraction: current.roadFraction,
      side: current.roadFraction < 0.5 ? 'route-left' : 'route-right',
      surface: selectedSurface,
      toleranceMeters:
        selectedSurface === 'curb'
          ? 0.12
          : selectedSurface === 'ref-point'
            ? 0.08
            : 0.18,
    })
    if (result.undo) {
      const history = markUndoHistoryRef.current.get(result.undo.runId) ?? []
      history.push(result.undo)
      markUndoHistoryRef.current.set(result.undo.runId, history)
      setUndoAvailable(true)
    }
    const updatedMark = selectedDrivingLineRun(result.document).marks.find(
      (mark) => mark.contactSlot === contactSlot,
    )
    focusedContactMarkIdRef.current = updatedMark?.id ?? null
    setFocusedContactMarkId(updatedMark?.id ?? null)
    replaceLabDocument(result.document)
  }, [comparisonVehicleTime, invalidateSaveState, playing, replaceLabDocument])

  const undoSelectedMark = useCallback(() => {
    cancelPendingContactNavigation()
    invalidateSaveState()
    const document = labDocumentRef.current
    const history = markUndoHistoryRef.current.get(document.selectedRunId)
    const undo = history?.pop()
    focusedContactMarkIdRef.current = null
    setFocusedContactMarkId(null)
    const nextDocument =
      undo
        ? restoreDrivingLineMarkUndo(document, undo)
        : undoLastDrivingLineMark(document)
    const run = selectedDrivingLineRun(nextDocument)
    const contactSlot = Math.min(
      selectedContactSlotRef.current,
      run.contactSlotCount,
    )
    replaceLabDocument(nextDocument)
    setUndoAvailable(
      (history?.length ?? 0) > 0 || run.marks.length > 0,
    )
    focusContactSlot(run, contactSlot)
  }, [
    cancelPendingContactNavigation,
    focusContactSlot,
    invalidateSaveState,
    replaceLabDocument,
  ])

  const saveSelectedRunToWorkspace = useCallback(async () => {
    const requestEpoch = saveRequestEpochRef.current + 1
    saveRequestEpochRef.current = requestEpoch
    const body = serializeDrivingLineRun(labDocument, selectedRun)
    setSaveState({ status: 'saving' })
    try {
      const response = await fetch('/api/driving-line-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      const result = (await response.json()) as {
        path?: string
        error?: string
      }
      if (!response.ok || !result.path) {
        throw new Error(result.error ?? `Save failed (${response.status})`)
      }
      if (requestEpoch !== saveRequestEpochRef.current) return
      setSaveState({ status: 'saved', path: result.path })
    } catch (error) {
      if (requestEpoch !== saveRequestEpochRef.current) return
      setSaveState({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Could not save this pass.',
      })
    }
  }, [labDocument, selectedRun])

  const downloadSelectedRun = useCallback(() => {
    const blob = new Blob([serializeDrivingLineRun(labDocument, selectedRun)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selectedRun.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [labDocument, selectedRun])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (preservesNativeKeyboardControl(event)) return
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') {
        if (event.repeat) return
        event.preventDefault()
        undoSelectedMark()
        return
      }
      if (event.code === 'Space') {
        if (event.repeat) return
        event.preventDefault()
        handlePlayPause()
        return
      }
      if (event.code === 'Enter' || event.code === 'KeyM') {
        if (event.repeat) return
        event.preventDefault()
        markCurrentContact()
        return
      }
      if (event.code === 'KeyE') {
        if (event.repeat) return
        event.preventDefault()
        downloadSelectedRun()
        return
      }
      if (event.code === 'KeyW' || event.code === 'ArrowUp') {
        if (event.repeat) return
        event.preventDefault()
        beginForward(event.code)
        return
      }
      if (event.code === 'KeyS' || event.code === 'ArrowDown') {
        event.preventDefault()
        stepBackward()
        return
      }
      if (
        event.code === 'KeyA' ||
        event.code === 'KeyD' ||
        event.code === 'ArrowLeft' ||
        event.code === 'ArrowRight'
      ) {
        event.preventDefault()
        beginLateral(
          event.code === 'KeyA' || event.code === 'ArrowLeft' ? -1 : 1,
          event.code,
        )
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (preservesNativeKeyboardControl(event)) return
      if (event.code === 'KeyW' || event.code === 'ArrowUp') {
        event.preventDefault()
        endForward(event.code)
      }
      if (
        event.code === 'KeyA' ||
        event.code === 'KeyD' ||
        event.code === 'ArrowLeft' ||
        event.code === 'ArrowRight'
      ) {
        event.preventDefault()
        endLateral(event.code)
      }
    }
    const releaseAll = () => {
      forwardKeysRef.current.clear()
      persistentPlaybackRef.current = false
      releaseLateralControls()
      pauseVideo()
    }
    const handleVisibilityChange = () => {
      if (document.hidden) releaseAll()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      releaseLateralControls()
    }
  }, [
    beginForward,
    beginLateral,
    downloadSelectedRun,
    endForward,
    endLateral,
    handlePlayPause,
    markCurrentContact,
    pauseVideo,
    releaseLateralControls,
    stepBackward,
    undoSelectedMark,
  ])

  const displayedRoadFraction = viewerRoadFraction(
    corridorSample?.roadFraction ?? 0.5,
  )

  const handleCameraViewChange = useCallback(
    (nextView: 'overhead' | 'onboard') => {
      const nextLeadSeconds = drivingLineVideoLeadForCameraView(nextView)
      videoLeadSecondsRef.current = nextLeadSeconds
      vehicleTimeOffsetSecondsRef.current =
        nextView === 'onboard' ? comparisonOffsetSecondsRef.current : 0
      setCameraView(nextView)
      // Preserve the car's canonical lap time while changing only how far the
      // real footage previews ahead of it.
      seekVehicleTime(playheadRef.current, nextLeadSeconds)
    },
    [seekVehicleTime],
  )

  const handleComparisonOffsetChange = useCallback(
    (seconds: number) => {
      const next = clampDrivingLineComparisonOffset(seconds)
      comparisonOffsetSecondsRef.current = next
      setComparisonOffsetSeconds(next)
      if (cameraView !== 'onboard') return
      vehicleTimeOffsetSecondsRef.current = next
      latestCorridorSampleRef.current = null
      latestDriveFrameRef.current = null
      setCorridorSample(null)
      markReplaySeek(playheadRef.current)
    },
    [cameraView, markReplaySeek],
  )

  const handleScrub = useCallback(
    (seconds: number) => {
      cancelPendingContactNavigation()
      seekVehicleTime(seconds)
    },
    [cancelPendingContactNavigation, seekVehicleTime],
  )

  const handleSelectRun = useCallback(
    (runId: string) => {
      const document = labDocumentRef.current
      const run = document.runs.find((candidate) => candidate.id === runId)
      if (!run) return
      invalidateSaveState()
      replaceLabDocument(selectDrivingLineRun(document, runId))
      const contactSlot =
        contactSlotByRunRef.current.get(run.id) ??
        firstAvailableContactSlot(run)
      setUndoAvailable(
        (markUndoHistoryRef.current.get(run.id)?.length ?? 0) > 0 ||
          run.marks.length > 0,
      )
      focusContactSlot(run, contactSlot)
    },
    [focusContactSlot, invalidateSaveState, replaceLabDocument],
  )

  const handleNewRun = useCallback(() => {
    invalidateSaveState()
    const nextDocument = appendDrivingLineRun(labDocumentRef.current)
    const run = selectedDrivingLineRun(nextDocument)
    replaceLabDocument(nextDocument)
    setUndoAvailable(false)
    focusContactSlot(run, 1)
  }, [focusContactSlot, invalidateSaveState, replaceLabDocument])

  const handleAddContactSlot = useCallback(() => {
    const document = labDocumentRef.current
    const previousRun = selectedDrivingLineRun(document)
    const contactSlot = selectedContactSlotRef.current
    const nextDocument = addDrivingLineContactSlot(document, contactSlot)
    if (nextDocument === document) return
    const history = markUndoHistoryRef.current.get(previousRun.id) ?? []
    history.push({ runId: previousRun.id, previousRun })
    markUndoHistoryRef.current.set(previousRun.id, history)
    setUndoAvailable(true)
    invalidateSaveState()
    const run = selectedDrivingLineRun(nextDocument)
    replaceLabDocument(nextDocument)
    focusContactSlot(run, contactSlot + 1)
  }, [focusContactSlot, invalidateSaveState, replaceLabDocument])

  const handleRemoveContactSlot = useCallback(() => {
    const document = labDocumentRef.current
    const previousRun = selectedDrivingLineRun(document)
    const contactSlot = selectedContactSlotRef.current
    const nextDocument = removeDrivingLineContactSlot(document, contactSlot)
    if (nextDocument === document) return
    const history = markUndoHistoryRef.current.get(previousRun.id) ?? []
    history.push({ runId: previousRun.id, previousRun })
    markUndoHistoryRef.current.set(previousRun.id, history)
    setUndoAvailable(true)
    invalidateSaveState()
    const run = selectedDrivingLineRun(nextDocument)
    const nextContactSlot = Math.min(contactSlot, run.contactSlotCount)
    replaceLabDocument(nextDocument)
    focusContactSlot(run, nextContactSlot)
  }, [focusContactSlot, invalidateSaveState, replaceLabDocument])

  return (
    <div className={appStyles.app} data-driving-line-lab="true">
      <div
        className={appStyles.scene}
        aria-label={
          cameraView === 'overhead'
            ? 'Driving Line Lab aerial track view'
            : 'Driving Line Lab 3D onboard track view'
        }
      >
        <TrackScene
          replay={replay}
          playheadSeconds={playheadSeconds}
          playing={playing}
          videoRef={videoRef}
          lapWindow={lapWindow}
          racingLineAnchors={DEFAULT_RACING_LINE_ANCHORS}
          authoredLinePoints={acceptedLinePoints}
          drivingLinePreviewPoints={previewPoints}
          replaySeekRef={replaySeekRef}
          sceneRenderEpoch={sceneRenderEpoch}
          videoPreviewLeadSeconds={activeVideoLeadSeconds}
          vehicleTimeOffsetSeconds={activeComparisonOffsetSeconds}
          cameraModeOverride={cameraView}
          overheadCameraHeightMeters={cameraHeightMeters}
          calibrationDriveInputRef={manualDriveInputRef}
          onCalibrationSample={handleCorridorSample}
          onCalibrationDriveFrame={handleDriveFrame}
        />
      </div>

      <section className={appStyles.onboard} aria-label="Onboard camera">
        <OnboardVideo
          ref={videoRef}
          playing={playing}
          playbackRate={playbackRate}
          lapWindow={lapWindow}
          timelineEndExtensionSeconds={activeVideoLeadSeconds}
          onLapTimeUpdate={handleLapTimeUpdate}
          onPlayState={handlePlayState}
          onSourceReady={setVideoReady}
        />
      </section>

      <div className={appStyles.nav}>
        <NavBar />
      </div>

      <div className={appStyles.playhead}>
        <Playhead
          playing={playing}
          disabled={!videoReady}
          playheadSeconds={playheadSeconds}
          startSeconds={0}
          durationSeconds={durationSeconds}
          playbackRate={playbackRate}
          onPlayPause={handlePlayPause}
          onScrub={handleScrub}
          onPlaybackRateChange={setPlaybackRate}
        />
      </div>

      <DrivingLineLabPanel
        runs={labDocument.runs}
        selectedRun={selectedRun}
        selectedContactSlot={selectedContactSlot}
        surface={surface}
        playing={playing}
        ready={videoReady && sampleAtPlayhead}
        playheadSeconds={playheadSeconds}
        durationSeconds={durationSeconds}
        offsetMeters={corridorSample?.offsetMeters ?? 0}
        roadFraction={displayedRoadFraction}
        boundaryLimited={corridorSample?.boundaryLimited ?? false}
        cameraView={cameraView}
        videoLeadSeconds={activeVideoLeadSeconds}
        comparisonOffsetSeconds={comparisonOffsetSeconds}
        cameraHeightMeters={cameraHeightMeters}
        saveState={saveState}
        canUndo={undoAvailable}
        onSelectRun={handleSelectRun}
        onSelectContactSlot={(contactSlot) =>
          focusContactSlot(selectedRun, contactSlot)
        }
        onNewRun={handleNewRun}
        onAddContactSlot={handleAddContactSlot}
        onRemoveContactSlot={handleRemoveContactSlot}
        onSurfaceChange={selectSurface}
        onMark={markCurrentContact}
        onUndo={undoSelectedMark}
        onSaveWorkspace={() => void saveSelectedRunToWorkspace()}
        onDownload={downloadSelectedRun}
        onCameraViewChange={handleCameraViewChange}
        onComparisonOffsetChange={handleComparisonOffsetChange}
        onCameraHeightChange={(heightMeters) => {
          const nextHeight = clampCalibrationCameraHeight(heightMeters)
          setCameraHeightMeters(nextHeight)
        }}
        onForwardStart={() => beginForward('pointer')}
        onForwardEnd={() => endForward('pointer')}
        onStepBackward={stepBackward}
        onLateralStart={(direction) => beginLateral(direction)}
        onLateralEnd={() => endLateral()}
      />
    </div>
  )
}
