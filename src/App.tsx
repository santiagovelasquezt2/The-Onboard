import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import { NavBar, type MainReplayViewMode } from './components/NavBar'
import { OnboardVideo } from './components/OnboardVideo'
import { Playhead } from './components/Playhead'
import { TrackScene } from './components/TrackScene'
import {
  CalibrationPanel,
  type CalibrationRunMode,
} from './components/CalibrationPanel'
import type { ReplayCorridorSample } from './components/scene/replayMotion'
import { CALIBRATION_SECTIONS } from './calibrationSections'
import {
  clampLapTimelineTime,
  lapTimeFromVideoTime,
  lapTimelineStartSeconds,
  ONBOARD_LAP_START_SECONDS,
  videoLapEndSeconds,
  videoTimeFromLapTime,
  type LapWindow,
} from './lapWindow'
import { loadReplay } from './replay'
import {
  cyclicProgressDistance,
  type CalibrationDriveInput,
  type CalibrationDriveSample,
} from './authoredRacingLine'
import {
  viewerDeltaToRouteDelta,
  viewerDirectionToRouteDirection,
} from './calibrationControls'
import {
  CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  clampCalibrationCameraHeight,
} from './calibrationCamera'
import {
  calibrationVideoLeadForRecording,
  previewVideoLapTimeFromVehicleLapTime,
  vehicleLapTimeFromPreviewVideoLapTime,
} from './calibrationVideoLead'
import type { ReplaySeekState } from './playbackClock'
import {
  readStoredReplaySyncAnchors,
  storeReplaySyncAnchors,
  type ReplaySyncAnchor,
} from './replaySyncCalibration'
import {
  readStoredRacingLineAnchors,
  type RacingLineAnchor,
} from './racingLineCalibration'
import {
  DEFAULT_RACING_LINE_ANCHORS,
  DEFAULT_REPLAY_DURATION_SECONDS,
} from './replayDefaults'
import {
  flattenSectionLineTakes,
  inheritedSectionEntry,
  readStoredSectionRacingLine,
  replaceSectionLineTake,
  sectionHasTake,
  storeSectionRacingLine,
  type SectionLineTake,
  type SectionTakeEntry,
} from './sectionRacingLine'
import { DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS } from './drivingLineComparisonTiming'
import {
  PROPOSED_DRIVING_LINE_ANALYSIS,
  PROPOSED_DRIVING_LINE_MARKS,
  PROPOSED_DRIVING_LINE_POINTS_ONE,
  PROPOSED_DRIVING_LINE_POINTS_TWO,
} from './proposedDrivingLinePass'

const DEFAULT_DURATION = DEFAULT_REPLAY_DURATION_SECONDS
const CALIBRATION_DEFAULT_PLAYBACK_RATE = 0.1
const SECTION_START_TOLERANCE_SECONDS = 0.08
const SELECTED_CALIBRATION_SECTION_STORAGE_KEY =
  'theonboard:montreal:selected-calibration-section:v1'

type ActiveCalibrationRun = {
  sectionId: string
  entry: SectionTakeEntry
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function sampleWithOffset(
  sample: ReplayCorridorSample,
  offsetMeters: number,
  lapTimeSeconds: number,
): CalibrationDriveSample {
  const width = sample.maximumOffsetMeters - sample.minimumOffsetMeters
  const clampedOffset = clamp(
    offsetMeters,
    sample.minimumOffsetMeters,
    sample.maximumOffsetMeters,
  )
  return {
    lapTimeSeconds,
    routeProgress: sample.routeProgress,
    offsetMeters: clampedOffset,
    minimumOffsetMeters: sample.minimumOffsetMeters,
    maximumOffsetMeters: sample.maximumOffsetMeters,
    roadFraction:
      width > 1e-9
        ? (clampedOffset - sample.minimumOffsetMeters) / width
        : 0.5,
    boundaryLimited: false,
  }
}

function appendDriveSample(
  take: CalibrationDriveSample[],
  sample: CalibrationDriveSample,
) {
  const previous = take[take.length - 1]
  if (
    previous &&
    cyclicProgressDistance(previous.routeProgress, sample.routeProgress) <= 1e-6
  ) {
    take[take.length - 1] = sample
  } else {
    take.push(sample)
  }
}

function readStoredCalibrationSectionIndex() {
  if (typeof window === 'undefined') return null
  try {
    const sectionId = window.localStorage.getItem(
      SELECTED_CALIBRATION_SECTION_STORAGE_KEY,
    )
    const index = CALIBRATION_SECTIONS.findIndex(
      (section) => section.id === sectionId,
    )
    return index >= 0 ? index : null
  } catch {
    return null
  }
}

function storeSelectedCalibrationSection(sectionId: string) {
  try {
    window.localStorage.setItem(
      SELECTED_CALIBRATION_SECTION_STORAGE_KEY,
      sectionId,
    )
  } catch {
    // The recorder still works for this tab when browser storage is disabled.
  }
}

export default function App() {
  const calibrationMode = useMemo(
    () => new URLSearchParams(window.location.search).get('calibrate') === '1',
    [],
  )
  const restoredSectionIndex = useMemo(
    () => (calibrationMode ? readStoredCalibrationSectionIndex() : null),
    [calibrationMode],
  )
  const [playheadSeconds, setPlayheadSeconds] = useState(
    -ONBOARD_LAP_START_SECONDS,
  )
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_DURATION)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(() =>
    calibrationMode ? CALIBRATION_DEFAULT_PLAYBACK_RATE : 1,
  )
  const [videoReady, setVideoReady] = useState(false)
  const [replay, setReplay] = useState<Awaited<
    ReturnType<typeof loadReplay>
  > | null>(null)
  const [racingLineAnchors] = useState<RacingLineAnchor[]>(() =>
    readStoredRacingLineAnchors(DEFAULT_RACING_LINE_ANCHORS, DEFAULT_DURATION),
  )
  const [sectionTakes, setSectionTakes] = useState<SectionLineTake[]>(
    readStoredSectionRacingLine,
  )
  const [replaySyncAnchors] = useState<ReplaySyncAnchor[]>(() =>
    readStoredReplaySyncAnchors(DEFAULT_DURATION),
  )
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(
    restoredSectionIndex ?? 0,
  )
  const [calibrationRunMode, setCalibrationRunMode] =
    useState<CalibrationRunMode>('ready')
  const [calibrationCameraView, setCalibrationCameraView] = useState<
    'overhead' | 'onboard'
  >('overhead')
  const [mainReplayView, setMainReplayView] =
    useState<MainReplayViewMode>('current')
  const [entryOffsetOverride, setEntryOffsetOverride] = useState<number | null>(
    null,
  )
  const [entryIsManual, setEntryIsManual] = useState(false)
  const [calibrationSample, setCalibrationSample] =
    useState<ReplayCorridorSample | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const replaySeekRef = useRef<ReplaySeekState>({
    seekEpoch: 0,
    pendingLapTimeSeconds: null,
  })
  const calibrationDriveInputRef = useRef<CalibrationDriveInput>({
    active: false,
    direction: 0,
    sessionId: 0,
    initialOffsetMeters: null,
    previewOffsetMeters: null,
    sectionEndLapTimeSeconds: null,
    mode: null,
  })
  const calibrationCameraHeightRef = useRef(
    CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  )
  const calibrationTakeRef = useRef<CalibrationDriveSample[]>([])
  const latestCalibrationDriveSampleRef =
    useRef<CalibrationDriveSample | null>(null)
  const activeCalibrationRunRef = useRef<ActiveCalibrationRun | null>(null)
  const restoreSelectedSectionRef = useRef(restoredSectionIndex !== null)
  const pressedSteeringKeysRef = useRef(new Set<string>())
  const pointerSteeringDirectionRef = useRef<-1 | 0 | 1>(0)

  const lapWindow = useMemo<LapWindow>(
    () => ({
      videoStartSeconds: ONBOARD_LAP_START_SECONDS,
      lapDurationSeconds: durationSeconds,
    }),
    [durationSeconds],
  )
  const selectedSection = CALIBRATION_SECTIONS[selectedSectionIndex]
  const inheritedEntry = inheritedSectionEntry(sectionTakes, selectedSection.id)
  const savedSelectedSection = sectionHasTake(sectionTakes, selectedSection.id)
  const calibrationRecording = calibrationRunMode === 'recording'
  const calibrationReviewing = calibrationRunMode === 'reviewing'
  const calibrationBusy = calibrationRecording || calibrationReviewing
  const calibrationVideoLeadSeconds = calibrationVideoLeadForRecording(
    calibrationRecording,
    selectedSection.endLapTimeSeconds,
    lapWindow,
  )
  const displayedEntryOffset =
    entryOffsetOverride ??
    inheritedEntry?.offsetMeters ??
    calibrationSample?.offsetMeters ??
    0
  const displayedRoadFraction = calibrationSample?.roadFraction ?? 0.5
  const atSectionStart =
    Math.abs(playheadSeconds - selectedSection.startLapTimeSeconds) <=
    SECTION_START_TOLERANCE_SECONDS
  const calibrationSampleAtSectionStart = Boolean(
    calibrationSample &&
      typeof calibrationSample.calibrationLapTimeSeconds === 'number' &&
      Math.abs(
        calibrationSample.calibrationLapTimeSeconds -
          selectedSection.startLapTimeSeconds,
      ) <= SECTION_START_TOLERANCE_SECONDS,
  )
  const recordingAvailable = videoReady && calibrationSampleAtSectionStart
  const authoredLinePoints = useMemo(
    () => flattenSectionLineTakes(sectionTakes),
    [sectionTakes],
  )

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
          '[replay] cache unavailable; using static scene pose',
          error,
        )
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    storeSectionRacingLine(sectionTakes)
  }, [sectionTakes])

  useEffect(() => {
    storeReplaySyncAnchors(replaySyncAnchors, durationSeconds)
  }, [durationSeconds, replaySyncAnchors])

  useEffect(() => {
    calibrationDriveInputRef.current.previewOffsetMeters =
      calibrationMode && calibrationRunMode === 'ready' && atSectionStart
        ? entryOffsetOverride
        : null
  }, [atSectionStart, calibrationMode, calibrationRunMode, entryOffsetOverride])

  const handleLapTimeUpdate = useCallback(
    (videoLapTimeSeconds: number) => {
      setPlayheadSeconds(
        vehicleLapTimeFromPreviewVideoLapTime(
          videoLapTimeSeconds,
          calibrationVideoLeadSeconds,
          lapWindow,
        ),
      )
    },
    [calibrationVideoLeadSeconds, lapWindow],
  )

  const markReplaySeek = useCallback((lapTimeSeconds: number) => {
    replaySeekRef.current.seekEpoch += 1
    replaySeekRef.current.pendingLapTimeSeconds = lapTimeSeconds
  }, [])

  const releaseCalibrationSteering = useCallback(() => {
    pressedSteeringKeysRef.current.clear()
    pointerSteeringDirectionRef.current = 0
    calibrationDriveInputRef.current.direction = 0
  }, [])

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!videoReady || !video) return

    if (video.paused) {
      const lapEnd = videoLapEndSeconds(lapWindow)
      if (
        playheadSeconds >= durationSeconds ||
        video.currentTime >= lapEnd - 0.001
      ) {
        markReplaySeek(lapTimelineStartSeconds(lapWindow))
        video.currentTime = 0
        setPlayheadSeconds(lapTimelineStartSeconds(lapWindow))
      }
      void video.play().catch(() => {
        setPlaying(false)
      })
      return
    }

    releaseCalibrationSteering()
    video.pause()
    setPlaying(false)
  }, [
    durationSeconds,
    lapWindow,
    markReplaySeek,
    playheadSeconds,
    releaseCalibrationSteering,
    videoReady,
  ])

  const handleScrub = useCallback(
    (seconds: number) => {
      if (!videoReady) return

      const lapTime = clampLapTimelineTime(seconds, lapWindow)
      setPlayheadSeconds(lapTime)
      const video = videoRef.current
      if (video) {
        markReplaySeek(lapTime)
        video.currentTime = videoTimeFromLapTime(lapTime, lapWindow)
      }
    },
    [lapWindow, markReplaySeek, videoReady],
  )

  const pauseForCalibration = useCallback(() => {
    videoRef.current?.pause()
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (
      !calibrationMode ||
      !videoReady ||
      !restoreSelectedSectionRef.current
    ) {
      return
    }

    restoreSelectedSectionRef.current = false
    pauseForCalibration()
    handleScrub(selectedSection.startLapTimeSeconds)
  }, [
    calibrationMode,
    handleScrub,
    pauseForCalibration,
    selectedSection.startLapTimeSeconds,
    videoReady,
  ])

  const handleCalibrationCameraHeightChange = useCallback(
    (nextHeightMeters: number) => {
      calibrationCameraHeightRef.current = clampCalibrationCameraHeight(
        nextHeightMeters,
      )
    },
    [],
  )

  const refreshSteeringDirection = useCallback(() => {
    const pressed = pressedSteeringKeysRef.current
    const pointerDirection = pointerSteeringDirectionRef.current
    const left =
      pointerDirection === -1 ||
      pressed.has('KeyA') ||
      pressed.has('ArrowLeft')
    const right =
      pointerDirection === 1 ||
      pressed.has('KeyD') ||
      pressed.has('ArrowRight')
    calibrationDriveInputRef.current.direction =
      viewerDirectionToRouteDirection(left === right ? 0 : left ? -1 : 1)
  }, [])

  const handleCalibrationDriveSample = useCallback(
    (sample: CalibrationDriveSample) => {
      appendDriveSample(calibrationTakeRef.current, sample)
    },
    [],
  )

  const handleCalibrationDriveFrame = useCallback(
    (sample: CalibrationDriveSample) => {
      latestCalibrationDriveSampleRef.current = sample
    },
    [],
  )

  const returnToSelectedSectionStart = useCallback(() => {
    if (calibrationBusy) return
    pauseForCalibration()
    handleScrub(selectedSection.startLapTimeSeconds)
  }, [calibrationBusy, handleScrub, pauseForCalibration, selectedSection])

  const finishCalibrationRecording = useCallback(() => {
    const activeRun = activeCalibrationRunRef.current
    const driveInput = calibrationDriveInputRef.current
    if (!activeRun || driveInput.mode !== 'record') return

    const take = [...calibrationTakeRef.current]
    const latest = latestCalibrationDriveSampleRef.current
    if (latest) appendDriveSample(take, latest)

    const finishedSection = CALIBRATION_SECTIONS.find(
      (section) => section.id === activeRun.sectionId,
    )
    pauseForCalibration()
    if (finishedSection && videoRef.current) {
      markReplaySeek(finishedSection.endLapTimeSeconds)
      videoRef.current.currentTime = videoTimeFromLapTime(
        finishedSection.endLapTimeSeconds,
        lapWindow,
      )
      setPlayheadSeconds(finishedSection.endLapTimeSeconds)
    }
    driveInput.active = false
    driveInput.mode = null
    driveInput.initialOffsetMeters = null
    driveInput.previewOffsetMeters = null
    driveInput.sectionEndLapTimeSeconds = null
    releaseCalibrationSteering()
    calibrationTakeRef.current = []
    latestCalibrationDriveSampleRef.current = null
    activeCalibrationRunRef.current = null
    setCalibrationRunMode('ready')
    if (take.length === 0) return

    const entryOffset = take[0].offsetMeters
    setEntryOffsetOverride(entryOffset)
    setSectionTakes((current) => {
      const next = replaceSectionLineTake(
        current,
        activeRun.sectionId,
        take,
        activeRun.entry,
      )
      storeSectionRacingLine(next)
      return next
    })
  }, [
    lapWindow,
    markReplaySeek,
    pauseForCalibration,
    releaseCalibrationSteering,
  ])

  const cancelCalibrationRecording = useCallback(() => {
    const driveInput = calibrationDriveInputRef.current
    if (driveInput.mode !== 'record') return
    pauseForCalibration()
    const video = videoRef.current
    const vehicleLapTimeSeconds = vehicleLapTimeFromPreviewVideoLapTime(
      video
        ? lapTimeFromVideoTime(video.currentTime, lapWindow)
        : playheadSeconds,
      calibrationVideoLeadSeconds,
      lapWindow,
    )
    if (video) {
      markReplaySeek(vehicleLapTimeSeconds)
      video.currentTime = videoTimeFromLapTime(vehicleLapTimeSeconds, lapWindow)
    }
    setPlayheadSeconds(vehicleLapTimeSeconds)
    driveInput.active = false
    driveInput.mode = null
    driveInput.initialOffsetMeters = null
    driveInput.sectionEndLapTimeSeconds = null
    driveInput.previewOffsetMeters = null
    releaseCalibrationSteering()
    calibrationTakeRef.current = []
    latestCalibrationDriveSampleRef.current = null
    activeCalibrationRunRef.current = null
    setCalibrationRunMode('ready')
  }, [
    calibrationVideoLeadSeconds,
    lapWindow,
    markReplaySeek,
    pauseForCalibration,
    playheadSeconds,
    releaseCalibrationSteering,
  ])

  const stopSectionReview = useCallback(
    (atBoundary = false) => {
      const driveInput = calibrationDriveInputRef.current
      if (driveInput.mode !== 'review') return
      const endLapTime = driveInput.sectionEndLapTimeSeconds
      pauseForCalibration()
      if (atBoundary && typeof endLapTime === 'number' && videoRef.current) {
        markReplaySeek(endLapTime)
        videoRef.current.currentTime = videoTimeFromLapTime(endLapTime, lapWindow)
        setPlayheadSeconds(endLapTime)
      }
      driveInput.mode = null
      driveInput.sectionEndLapTimeSeconds = null
      driveInput.previewOffsetMeters = null
      setCalibrationRunMode('ready')
    },
    [lapWindow, markReplaySeek, pauseForCalibration],
  )

  const handleCalibrationSectionEnd = useCallback(
    (mode: 'record' | 'review') => {
      if (mode === 'record') finishCalibrationRecording()
      else stopSectionReview(true)
    },
    [finishCalibrationRecording, stopSectionReview],
  )

  const startCalibrationRecording = useCallback(() => {
    const video = videoRef.current
    if (
      !videoReady ||
      !video ||
      !calibrationSample ||
      calibrationBusy ||
      !atSectionStart ||
      !recordingAvailable
    ) {
      return
    }

    const inheritedOffset = inheritedEntry?.offsetMeters
    const requestedOffset =
      entryOffsetOverride ?? inheritedOffset ?? calibrationSample.offsetMeters
    const entryOffset = clamp(
      requestedOffset,
      calibrationSample.minimumOffsetMeters,
      calibrationSample.maximumOffsetMeters,
    )
    const entry: SectionTakeEntry = entryIsManual
      ? { mode: 'manual', offsetMeters: entryOffset }
      : { mode: 'inherit' }
    video.playbackRate = playbackRate
    calibrationTakeRef.current = [
      sampleWithOffset(calibrationSample, entryOffset, playheadSeconds),
    ]
    latestCalibrationDriveSampleRef.current = calibrationTakeRef.current[0]
    activeCalibrationRunRef.current = { sectionId: selectedSection.id, entry }
    releaseCalibrationSteering()
    const driveInput = calibrationDriveInputRef.current
    driveInput.sessionId += 1
    driveInput.active = true
    driveInput.mode = 'record'
    driveInput.initialOffsetMeters = entryOffset
    driveInput.previewOffsetMeters = null
    driveInput.sectionEndLapTimeSeconds = selectedSection.endLapTimeSeconds
    const recordingVideoLeadSeconds = calibrationVideoLeadForRecording(
      true,
      selectedSection.endLapTimeSeconds,
      lapWindow,
    )
    const previewVideoLapTimeSeconds = previewVideoLapTimeFromVehicleLapTime(
      selectedSection.startLapTimeSeconds,
      recordingVideoLeadSeconds,
      lapWindow,
    )
    markReplaySeek(selectedSection.startLapTimeSeconds)
    video.currentTime = videoTimeFromLapTime(
      previewVideoLapTimeSeconds,
      lapWindow,
    )
    setPlayheadSeconds(selectedSection.startLapTimeSeconds)
    setEntryOffsetOverride(entryOffset)
    setCalibrationCameraView('overhead')
    setCalibrationRunMode('recording')
    void video.play().catch(() => {
      driveInput.active = false
      driveInput.mode = null
      driveInput.initialOffsetMeters = null
      driveInput.sectionEndLapTimeSeconds = null
      driveInput.previewOffsetMeters = null
      activeCalibrationRunRef.current = null
      setCalibrationRunMode('ready')
    })
  }, [
    atSectionStart,
    calibrationBusy,
    calibrationSample,
    entryIsManual,
    entryOffsetOverride,
    inheritedEntry?.offsetMeters,
    playbackRate,
    playheadSeconds,
    lapWindow,
    markReplaySeek,
    releaseCalibrationSteering,
    selectedSection,
    recordingAvailable,
    videoReady,
  ])

  const startSectionReview = useCallback(() => {
    const video = videoRef.current
    if (!videoReady || !video || calibrationBusy || !savedSelectedSection) return

    pauseForCalibration()
    releaseCalibrationSteering()
    const driveInput = calibrationDriveInputRef.current
    driveInput.sessionId += 1
    driveInput.active = false
    driveInput.direction = 0
    driveInput.mode = 'review'
    driveInput.initialOffsetMeters = null
    driveInput.previewOffsetMeters = null
    driveInput.sectionEndLapTimeSeconds = selectedSection.endLapTimeSeconds
    markReplaySeek(selectedSection.startLapTimeSeconds)
    video.currentTime = videoTimeFromLapTime(
      selectedSection.startLapTimeSeconds,
      lapWindow,
    )
    setPlayheadSeconds(selectedSection.startLapTimeSeconds)
    setCalibrationRunMode('reviewing')
    void video.play().catch(() => {
      driveInput.mode = null
      driveInput.sectionEndLapTimeSeconds = null
      driveInput.previewOffsetMeters = null
      setCalibrationRunMode('ready')
    })
  }, [
    calibrationBusy,
    lapWindow,
    markReplaySeek,
    pauseForCalibration,
    releaseCalibrationSteering,
    savedSelectedSection,
    selectedSection,
    videoReady,
  ])

  const selectCalibrationSection = useCallback(
    (index: number) => {
      if (calibrationBusy || index < 0 || index >= CALIBRATION_SECTIONS.length) {
        return
      }
      const nextSection = CALIBRATION_SECTIONS[index]
      const nextInherited = inheritedSectionEntry(sectionTakes, nextSection.id)
      pauseForCalibration()
      releaseCalibrationSteering()
      storeSelectedCalibrationSection(nextSection.id)
      setSelectedSectionIndex(index)
      setEntryIsManual(false)
      setEntryOffsetOverride(nextInherited?.offsetMeters ?? null)
      calibrationDriveInputRef.current.previewOffsetMeters = null
      handleScrub(nextSection.startLapTimeSeconds)
    },
    [
      calibrationBusy,
      handleScrub,
      pauseForCalibration,
      releaseCalibrationSteering,
      sectionTakes,
    ],
  )

  const nudgeSectionEntry = useCallback(
    (deltaMeters: number) => {
      if (
        calibrationBusy ||
        !calibrationSample ||
        !atSectionStart ||
        !recordingAvailable
      ) {
        return
      }
      pauseForCalibration()
      const nextOffset = clamp(
        displayedEntryOffset + viewerDeltaToRouteDelta(deltaMeters),
        calibrationSample.minimumOffsetMeters,
        calibrationSample.maximumOffsetMeters,
      )
      setEntryOffsetOverride(nextOffset)
      setEntryIsManual(true)
      calibrationDriveInputRef.current.previewOffsetMeters = nextOffset
    },
    [
      atSectionStart,
      calibrationBusy,
      calibrationSample,
      displayedEntryOffset,
      pauseForCalibration,
      recordingAvailable,
    ],
  )

  const handleCalibrationSteerStart = useCallback(
    (direction: -1 | 1) => {
      if (!calibrationRecording || !playing) return
      pointerSteeringDirectionRef.current = direction
      refreshSteeringDirection()
    },
    [calibrationRecording, playing, refreshSteeringDirection],
  )

  const handleCalibrationSteerEnd = useCallback(() => {
    pointerSteeringDirectionRef.current = 0
    refreshSteeringDirection()
  }, [refreshSteeringDirection])

  useEffect(() => {
    if (!calibrationMode) return

    const textEntryTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.isContentEditable ||
        target.tagName === 'TEXTAREA' ||
        (target instanceof HTMLInputElement &&
          ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(
            target.type,
          ))
      )
    }
    const selectTarget = (target: EventTarget | null) =>
      target instanceof HTMLSelectElement
    const rangeTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement && target.type === 'range'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (textEntryTarget(event.target)) return
      if (event.code === 'KeyR') {
        if (event.repeat || calibrationRunMode !== 'ready') return
        event.preventDefault()
        startCalibrationRecording()
        return
      }
      if (event.code === 'Escape') {
        if (calibrationRecording) {
          event.preventDefault()
          cancelCalibrationRecording()
        } else if (calibrationReviewing) {
          event.preventDefault()
          stopSectionReview()
        }
        return
      }
      if (!['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        return
      }
      if (
        (selectTarget(event.target) || rangeTarget(event.target)) &&
        event.code.startsWith('Arrow')
      ) {
        return
      }
      event.preventDefault()
      if (calibrationRecording && playing) {
        pressedSteeringKeysRef.current.add(event.code)
        refreshSteeringDirection()
      } else if (calibrationRunMode === 'ready') {
        nudgeSectionEntry(
          event.code === 'KeyA' || event.code === 'ArrowLeft' ? -0.25 : 0.25,
        )
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!calibrationRecording) return
      if (!pressedSteeringKeysRef.current.delete(event.code)) return
      event.preventDefault()
      refreshSteeringDirection()
    }
    const handleVisibilityChange = () => {
      if (document.hidden) releaseCalibrationSteering()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseCalibrationSteering)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseCalibrationSteering)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    calibrationMode,
    calibrationRecording,
    calibrationReviewing,
    calibrationRunMode,
    cancelCalibrationRecording,
    nudgeSectionEntry,
    playing,
    refreshSteeringDirection,
    releaseCalibrationSteering,
    startCalibrationRecording,
    stopSectionReview,
  ])

  useEffect(
    () => () => {
      releaseCalibrationSteering()
    },
    [releaseCalibrationSteering],
  )

  const entrySource = entryIsManual
    ? 'adjusted'
    : inheritedEntry
      ? 'inherited'
      : 'automatic'
  const selectedProposal =
    !calibrationMode && mainReplayView !== 'current'
      ? mainReplayView === 'proposal-2'
        ? {
            label: 'Proposed onboard 2',
            points: PROPOSED_DRIVING_LINE_POINTS_TWO,
          }
        : {
            label: 'Proposed onboard 1',
            points: PROPOSED_DRIVING_LINE_POINTS_ONE,
          }
      : null

  return (
    <div
      className={styles.app}
      data-calibrating={calibrationMode || undefined}
      data-recording={calibrationRecording || undefined}
    >
      <div
        className={styles.scene}
        aria-label={
          calibrationMode
            ? calibrationCameraView === 'onboard'
              ? '3D onboard track view'
              : 'Aerial track view'
            : selectedProposal
              ? `${selectedProposal.label} 3D track view`
              : '3D replay track view'
        }
      >
        <TrackScene
          replay={replay}
          playheadSeconds={playheadSeconds}
          videoRef={videoRef}
          lapWindow={lapWindow}
          racingLineAnchors={racingLineAnchors}
          authoredLinePoints={
            selectedProposal?.points ?? authoredLinePoints
          }
          drivingLinePreviewPath={
            selectedProposal?.points
          }
          drivingLinePreviewPoints={
            selectedProposal ? PROPOSED_DRIVING_LINE_MARKS : undefined
          }
          replaySyncAnchors={replaySyncAnchors}
          replaySeekRef={replaySeekRef}
          videoPreviewLeadSeconds={calibrationVideoLeadSeconds}
          vehicleTimeOffsetSeconds={
            selectedProposal
              ? DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS
              : undefined
          }
          cameraModeOverride={
            calibrationMode
              ? calibrationCameraView
              : selectedProposal
                ? 'onboard'
                : undefined
          }
          calibrationDriveInputRef={
            calibrationMode ? calibrationDriveInputRef : undefined
          }
          calibrationCameraHeightRef={
            calibrationMode ? calibrationCameraHeightRef : undefined
          }
          onCalibrationSample={
            calibrationMode ? setCalibrationSample : undefined
          }
          onCalibrationDriveSample={
            calibrationMode ? handleCalibrationDriveSample : undefined
          }
          onCalibrationDriveFrame={
            calibrationMode ? handleCalibrationDriveFrame : undefined
          }
          onCalibrationDriveDiscontinuity={
            calibrationMode ? cancelCalibrationRecording : undefined
          }
          onCalibrationSectionEnd={
            calibrationMode ? handleCalibrationSectionEnd : undefined
          }
        />
      </div>

      <section className={styles.onboard} aria-label="Real onboard camera">
        <OnboardVideo
          ref={videoRef}
          playing={playing}
          playbackRate={playbackRate}
          lapWindow={lapWindow}
          onLapTimeUpdate={handleLapTimeUpdate}
          onPlayState={setPlaying}
          onSourceReady={setVideoReady}
        />
      </section>

      <div className={styles.nav}>
        <NavBar
          mainReplayView={calibrationMode ? undefined : mainReplayView}
          proposedPointCount={PROPOSED_DRIVING_LINE_ANALYSIS.markCount}
          onMainReplayViewChange={
            calibrationMode ? undefined : setMainReplayView
          }
        />
      </div>

      <div className={styles.playhead}>
        <Playhead
          playing={playing}
          disabled={!videoReady}
          scrubDisabled={calibrationBusy}
          playheadSeconds={playheadSeconds}
          startSeconds={lapTimelineStartSeconds(lapWindow)}
          durationSeconds={durationSeconds}
          playbackRate={playbackRate}
          onPlayPause={handlePlayPause}
          onScrub={handleScrub}
          onPlaybackRateChange={setPlaybackRate}
        />
      </div>

      {calibrationMode ? (
        <CalibrationPanel
          section={selectedSection}
          sectionIndex={selectedSectionIndex}
          sections={CALIBRATION_SECTIONS}
          savedSectionIds={sectionTakes.map((take) => take.sectionId)}
          saved={savedSelectedSection}
          mode={calibrationRunMode}
          playheadSeconds={playheadSeconds}
          entryOffsetMeters={displayedEntryOffset}
          roadFraction={displayedRoadFraction}
          entrySource={entrySource}
          boundaryLimited={calibrationSample?.boundaryLimited ?? false}
          recordingAvailable={recordingAvailable}
          reviewAvailable={videoReady}
          atSectionStart={atSectionStart}
          playing={playing}
          cameraView={calibrationCameraView}
          onSelectSection={selectCalibrationSection}
          onReturnToStart={returnToSelectedSectionStart}
          onNudgeEntry={nudgeSectionEntry}
          onCameraHeightChange={handleCalibrationCameraHeightChange}
          onCameraViewChange={setCalibrationCameraView}
          onStartRecording={startCalibrationRecording}
          onCancelRecording={cancelCalibrationRecording}
          onReview={startSectionReview}
          onStopReview={stopSectionReview}
          onSteerStart={handleCalibrationSteerStart}
          onSteerEnd={handleCalibrationSteerEnd}
        />
      ) : null}
    </div>
  )
}
