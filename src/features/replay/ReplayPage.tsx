import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './ReplayPage.module.css'
import {
  NavBar,
  type MainCameraMode,
  type ReplayWorkbookMode,
} from './components/NavBar'
import { PhysicsWorkbook } from './components/PhysicsWorkbook'
import { TelemetryWorkbook } from './components/TelemetryWorkbook'
import { OnboardVideo } from './components/OnboardVideo'
import { Playhead } from './components/Playhead'
import { ReplayEntryLoader } from './components/ReplayEntryLoader'
import { TrackScene } from './scene/TrackScene'
import {
  clampLapTimelineTime,
  lapTimelineStartSeconds,
  ONBOARD_LAP_START_SECONDS,
  videoLapEndSeconds,
  videoTimeFromLapTime,
  type LapWindow,
} from './lapWindow'
import type { ReplaySeekState } from './playbackClock'
import { loadReplay } from './replay'
import {
  DEFAULT_RACING_LINE_ANCHORS,
  DEFAULT_REPLAY_DURATION_SECONDS,
} from './replayDefaults'
import { DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS } from './calibration/drivingLineComparisonTiming'
import { PROPOSED_DRIVING_LINE_POINTS_TWO } from './calibration/proposedDrivingLinePass'

const MOBILE_REPLAY_MEDIA_QUERY = '(max-width: 900px)'

function initialMainCameraMode(): MainCameraMode {
  const requestedCamera = new URLSearchParams(window.location.search).get(
    'camera',
  )
  if (requestedCamera === 'chase' || requestedCamera === 'third-person') {
    return 'third-person'
  }
  return 'onboard'
}

function initialMobileViewport() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_REPLAY_MEDIA_QUERY).matches
  )
}

export default function ReplayPage() {
  const [playheadSeconds, setPlayheadSeconds] = useState(
    -ONBOARD_LAP_START_SECONDS,
  )
  const [durationSeconds, setDurationSeconds] = useState(
    DEFAULT_REPLAY_DURATION_SECONDS,
  )
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoReady, setVideoReady] = useState(false)
  const [videoFrameReady, setVideoFrameReady] = useState(false)
  const [scenePresented, setScenePresented] = useState(false)
  const [sceneUnavailable, setSceneUnavailable] = useState(false)
  const [loaderExitComplete, setLoaderExitComplete] = useState(false)
  const [nonVideoEntryFailure, setNonVideoEntryFailure] = useState<
    string | null
  >(null)
  const [videoEntryFailure, setVideoEntryFailure] = useState<string | null>(null)
  const [localVideoSourceUrl, setLocalVideoSourceUrl] = useState<string | null>(
    null,
  )
  const [replay, setReplay] = useState<Awaited<
    ReturnType<typeof loadReplay>
  > | null>(null)
  const [mainCameraMode, setMainCameraMode] =
    useState<MainCameraMode>(initialMainCameraMode)
  const [thirdPersonResetKey, setThirdPersonResetKey] = useState(0)
  const [replayWorkbookMode, setReplayWorkbookMode] =
    useState<ReplayWorkbookMode>('data')
  const [isMobileViewport, setIsMobileViewport] = useState(
    initialMobileViewport,
  )
  const [mobileWorkbookOpen, setMobileWorkbookOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const replaySurfaceRef = useRef<HTMLDivElement | null>(null)
  const localVideoSourceUrlRef = useRef<string | null>(null)
  const replaySeekRef = useRef<ReplaySeekState>({
    seekEpoch: 0,
    pendingLapTimeSeconds: null,
  })

  const lapWindow = useMemo<LapWindow>(
    () => ({
      videoStartSeconds: ONBOARD_LAP_START_SECONDS,
      lapDurationSeconds: durationSeconds,
    }),
    [durationSeconds],
  )
  const entryFailure = nonVideoEntryFailure ?? videoEntryFailure
  const canChooseLocalVideo =
    nonVideoEntryFailure === null && videoEntryFailure !== null
  const replayContentReady =
    replay !== null &&
    (scenePresented || sceneUnavailable) &&
    videoFrameReady &&
    entryFailure === null
  const replayEntryReady = loaderExitComplete

  const reportNonVideoEntryFailure = useCallback((message: string) => {
    setNonVideoEntryFailure((currentFailure) => currentFailure ?? message)
  }, [])
  const reportVideoEntryFailure = useCallback((message: string) => {
    setVideoEntryFailure((currentFailure) => currentFailure ?? message)
  }, [])
  const handleScenePresented = useCallback(() => {
    setScenePresented(true)
  }, [])
  const handleWebGLUnavailable = useCallback(() => {
    setSceneUnavailable(true)
  }, [])
  const handleSceneError = useCallback(() => {
    reportNonVideoEntryFailure('The 3D replay assets could not be loaded.')
  }, [reportNonVideoEntryFailure])
  const handleVideoError = useCallback(
    (message: string) => reportVideoEntryFailure(message),
    [reportVideoEntryFailure],
  )
  const handleVideoSourceMissing = useCallback(() => {
    reportVideoEntryFailure(
      'Choose your local onboard MP4 to start the synchronized lap.',
    )
  }, [reportVideoEntryFailure])
  const handleLoaderExitComplete = useCallback(() => {
    setLoaderExitComplete(true)
  }, [])
  const handleEntryRetry = useCallback(() => {
    window.location.reload()
  }, [])
  const handleChooseVideo = useCallback(
    (file: File) => {
      const looksLikeMp4 =
        file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4')
      if (!looksLikeMp4) {
        setVideoEntryFailure('Choose an MP4 video file.')
        return
      }

      const nextSourceUrl = URL.createObjectURL(file)
      const previousSourceUrl = localVideoSourceUrlRef.current
      if (previousSourceUrl) URL.revokeObjectURL(previousSourceUrl)
      localVideoSourceUrlRef.current = nextSourceUrl
      setPlaying(false)
      setVideoReady(false)
      setVideoFrameReady(false)
      setLoaderExitComplete(false)
      setPlayheadSeconds(-ONBOARD_LAP_START_SECONDS)
      setLocalVideoSourceUrl(nextSourceUrl)
      setVideoEntryFailure(null)
    },
    [],
  )

  useEffect(
    () => () => {
      const localSourceUrl = localVideoSourceUrlRef.current
      if (localSourceUrl) URL.revokeObjectURL(localSourceUrl)
    },
    [],
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const mobileViewport = window.matchMedia(MOBILE_REPLAY_MEDIA_QUERY)
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches)
      if (event.matches) setMobileWorkbookOpen(false)
    }

    mobileViewport.addEventListener('change', handleViewportChange)
    return () =>
      mobileViewport.removeEventListener('change', handleViewportChange)
  }, [])

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
        if (!cancelled) {
          reportNonVideoEntryFailure(
            'The replay telemetry could not be loaded.',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [reportNonVideoEntryFailure])

  const handleLapTimeUpdate = useCallback(
    (videoLapTimeSeconds: number) => {
      setPlayheadSeconds(
        clampLapTimelineTime(videoLapTimeSeconds, lapWindow),
      )
    },
    [lapWindow],
  )

  const markReplaySeek = useCallback((lapTimeSeconds: number) => {
    replaySeekRef.current.seekEpoch += 1
    replaySeekRef.current.pendingLapTimeSeconds = lapTimeSeconds
  }, [])

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!replayEntryReady || !videoReady || !video) return

    if (video.paused) {
      const lapEnd = videoLapEndSeconds(lapWindow)
      if (video.currentTime >= lapEnd - 0.001) {
        const timelineStart = lapTimelineStartSeconds(lapWindow)
        markReplaySeek(timelineStart)
        video.currentTime = 0
        setPlayheadSeconds(timelineStart)
      }
      void video.play().catch(() => {
        setPlaying(false)
      })
      return
    }

    video.pause()
    setPlaying(false)
  }, [
    lapWindow,
    markReplaySeek,
    replayEntryReady,
    videoReady,
  ])

  const handleScrub = useCallback(
    (seconds: number) => {
      if (!replayEntryReady || !videoReady) return

      const lapTime = clampLapTimelineTime(seconds, lapWindow)
      setPlayheadSeconds(lapTime)
      const video = videoRef.current
      if (video) {
        markReplaySeek(lapTime)
        video.currentTime = videoTimeFromLapTime(lapTime, lapWindow)
      }
    },
    [lapWindow, markReplaySeek, replayEntryReady, videoReady],
  )

  const resetThirdPersonCamera = useCallback(() => {
    setThirdPersonResetKey((current) => current + 1)
  }, [])

  const replayWorkbookOpen = !isMobileViewport || mobileWorkbookOpen
  // The 3D frame loop reads video.currentTime directly while playing. Keeping
  // this fallback prop stable avoids reconciling the Canvas on media updates;
  // paused scrubs still flow through so demand rendering refreshes immediately.
  const scenePlayheadSeconds = playing ? 0 : playheadSeconds
  const handleReplayWorkbookModeChange = useCallback(
    (mode: ReplayWorkbookMode) => {
      if (!isMobileViewport) {
        setReplayWorkbookMode(mode)
        return
      }

      if (mode === replayWorkbookMode) {
        setMobileWorkbookOpen((currentOpen) => !currentOpen)
        return
      }

      setReplayWorkbookMode(mode)
      setMobileWorkbookOpen(true)
    },
    [isMobileViewport, replayWorkbookMode],
  )

  useEffect(() => {
    const handleSpacebar = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'button, input, select, textarea, [contenteditable="true"]',
          ))
      ) {
        return
      }
      event.preventDefault()
      handlePlayPause()
    }

    window.addEventListener('keydown', handleSpacebar)
    return () => window.removeEventListener('keydown', handleSpacebar)
  }, [handlePlayPause])

  useEffect(() => {
    if (!replayEntryReady) return

    replaySurfaceRef.current?.focus({ preventScroll: true })
  }, [replayEntryReady])

  return (
    <div className={styles.app}>
      <div
        ref={replaySurfaceRef}
        className={styles.replaySurface}
        role="region"
        aria-label="Replay experience"
        aria-hidden={!replayEntryReady || undefined}
        inert={!replayEntryReady || undefined}
        tabIndex={-1}
      >
      <div
        className={styles.scene}
        aria-label={
          mainCameraMode === 'third-person'
            ? 'Third-person 3D track view'
            : 'TV Pod 3D track view'
        }
      >
        <TrackScene
          replay={replay}
          onScenePresented={handleScenePresented}
          onSceneError={handleSceneError}
          onWebGLUnavailable={handleWebGLUnavailable}
          playheadSeconds={scenePlayheadSeconds}
          playing={playing}
          videoRef={videoRef}
          lapWindow={lapWindow}
          racingLineAnchors={DEFAULT_RACING_LINE_ANCHORS}
          authoredLinePoints={PROPOSED_DRIVING_LINE_POINTS_TWO}
          drivingLinePreviewPath={PROPOSED_DRIVING_LINE_POINTS_TWO}
          replaySeekRef={replaySeekRef}
          vehicleTimeOffsetSeconds={
            DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS
          }
          cameraModeOverride={mainCameraMode}
          thirdPersonResetKey={thirdPersonResetKey}
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
          onFrameReady={setVideoFrameReady}
          onFrameError={handleVideoError}
          sourceUrl={localVideoSourceUrl ?? undefined}
          onSourceMissing={handleVideoSourceMissing}
        />
      </section>

      <div className={styles.nav}>
        <NavBar
          mainCameraMode={mainCameraMode}
          onMainCameraModeChange={setMainCameraMode}
          onResetThirdPerson={
            mainCameraMode === 'third-person'
              ? resetThirdPersonCamera
              : undefined
          }
          replayWorkbookMode={replayWorkbookMode}
          onReplayWorkbookModeChange={handleReplayWorkbookModeChange}
          replayWorkbookOpen={replayWorkbookOpen}
          replayWorkbookCollapsible={isMobileViewport}
        />
      </div>

      {replayWorkbookOpen ? (
        replayWorkbookMode === 'physics' ? (
          <PhysicsWorkbook replay={replay} playheadSeconds={playheadSeconds} />
        ) : (
          <TelemetryWorkbook replay={replay} playheadSeconds={playheadSeconds} />
        )
      ) : null}

      <div className={styles.playhead}>
        <Playhead
          playing={playing}
          disabled={!replayEntryReady || !videoReady}
          playheadSeconds={playheadSeconds}
          startSeconds={lapTimelineStartSeconds(lapWindow)}
          durationSeconds={durationSeconds}
          playbackRate={playbackRate}
          onPlayPause={handlePlayPause}
          onScrub={handleScrub}
          onPlaybackRateChange={setPlaybackRate}
        />
      </div>
      </div>

      {!replayEntryReady ? (
        <ReplayEntryLoader
          ready={replayContentReady}
          failure={entryFailure}
          onExitComplete={handleLoaderExitComplete}
          onRetry={handleEntryRetry}
          onChooseVideo={
            canChooseLocalVideo ? handleChooseVideo : undefined
          }
        />
      ) : null}
    </div>
  )
}
