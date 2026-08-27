import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import { NavBar } from './components/NavBar'
import { OnboardVideo } from './components/OnboardVideo'
import { Playhead } from './components/Playhead'
import { TrackScene } from './components/TrackScene'
import { CalibrationPanel } from './components/CalibrationPanel'
import type { ReplayCorridorSample } from './components/scene/replayMotion'
import { adjacentCurbContact } from './curbContacts'
import {
  clampLapTimelineTime,
  lapTimelineStartSeconds,
  ONBOARD_LAP_START_SECONDS,
  videoLapEndSeconds,
  videoTimeFromLapTime,
  type LapWindow,
} from './lapWindow'
import { loadReplay } from './replay'
import {
  nearestRacingLineAnchor,
  normalizeRacingLineAnchors,
  racingLineDeltaAtLapTime,
  readStoredRacingLineAnchors,
  removeNearestRacingLineAnchor,
  storeRacingLineAnchors,
  upsertRacingLineAnchor,
  type RacingLineAnchor,
} from './racingLineCalibration'

const DEFAULT_DURATION = 72
const CALIBRATION_FRAME_SECONDS = 1 / 50
const DEFAULT_RACING_LINE_ANCHORS: RacingLineAnchor[] = [
  { lapTimeSeconds: 2.0, deltaMeters: -1.6 },
  { lapTimeSeconds: 7.5, deltaMeters: -2.6 },
  { lapTimeSeconds: 11.5, deltaMeters: -3.4 },
  { lapTimeSeconds: 16.5, deltaMeters: -0.55 },
  { lapTimeSeconds: 19.5, deltaMeters: -1.6 },
  { lapTimeSeconds: 20.2, deltaMeters: -1.9 },
  { lapTimeSeconds: 21.5, deltaMeters: -2.0 },
  { lapTimeSeconds: 28.5, deltaMeters: -2.6 },
  { lapTimeSeconds: 32.0, deltaMeters: -1.4 },
  { lapTimeSeconds: 40.0, deltaMeters: -2.3 },
  { lapTimeSeconds: 42.0, deltaMeters: -4.0 },
  { lapTimeSeconds: 46.0, deltaMeters: -2.6 },
  { lapTimeSeconds: 48.0, deltaMeters: -3.6 },
  { lapTimeSeconds: 52.5, deltaMeters: -2.0 },
  { lapTimeSeconds: 55.0, deltaMeters: -3.3 },
  { lapTimeSeconds: 57.0, deltaMeters: -2.8 },
  { lapTimeSeconds: 58.5, deltaMeters: -2.6 },
  { lapTimeSeconds: 59.5, deltaMeters: -3.2 },
  { lapTimeSeconds: 60.5, deltaMeters: -3.6 },
  { lapTimeSeconds: 61.5, deltaMeters: -3.8 },
  { lapTimeSeconds: 62.2, deltaMeters: -3.6 },
  { lapTimeSeconds: 63.0, deltaMeters: -1.2 },
  { lapTimeSeconds: 63.6, deltaMeters: -0.2 }, // ease before T13 right curb
  { lapTimeSeconds: 68.5, deltaMeters: -1.8 },
  { lapTimeSeconds: 69.5, deltaMeters: -2.2 },
  { lapTimeSeconds: 70.5, deltaMeters: -2.4 },
]

export default function App() {
  const [playheadSeconds, setPlayheadSeconds] = useState(
    -ONBOARD_LAP_START_SECONDS,
  )
  const [durationSeconds, setDurationSeconds] = useState(DEFAULT_DURATION)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoReady, setVideoReady] = useState(false)
  const [replay, setReplay] = useState<Awaited<
    ReturnType<typeof loadReplay>
  > | null>(null)
  const [racingLineAnchors, setRacingLineAnchors] = useState<
    RacingLineAnchor[]
  >(() =>
    readStoredRacingLineAnchors(DEFAULT_RACING_LINE_ANCHORS, DEFAULT_DURATION),
  )
  const [calibrationSample, setCalibrationSample] =
    useState<ReplayCorridorSample | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const calibrationMode = useMemo(
    () => new URLSearchParams(window.location.search).get('calibrate') === '1',
    [],
  )

  const lapWindow = useMemo<LapWindow>(
    () => ({
      videoStartSeconds: ONBOARD_LAP_START_SECONDS,
      lapDurationSeconds: durationSeconds,
    }),
    [durationSeconds],
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
    storeRacingLineAnchors(racingLineAnchors)
  }, [racingLineAnchors])

  const handleLapTimeUpdate = useCallback(
    (seconds: number) =>
      setPlayheadSeconds(clampLapTimelineTime(seconds, lapWindow)),
    [lapWindow],
  )

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!videoReady || !video) return

    if (video.paused) {
      const lapEnd = videoLapEndSeconds(lapWindow)
      if (
        playheadSeconds >= durationSeconds ||
        video.currentTime >= lapEnd - 0.001
      ) {
        video.currentTime = 0
        setPlayheadSeconds(lapTimelineStartSeconds(lapWindow))
      }
      void video.play()
      setPlaying(true)
      return
    }

    video.pause()
    setPlaying(false)
  }, [durationSeconds, lapWindow, playheadSeconds, videoReady])

  const handleScrub = useCallback(
    (seconds: number) => {
      if (!videoReady) return

      const lapTime = clampLapTimelineTime(seconds, lapWindow)
      setPlayheadSeconds(lapTime)
      const video = videoRef.current
      if (videoReady && video) {
        video.currentTime = videoTimeFromLapTime(lapTime, lapWindow)
      }
    },
    [lapWindow, videoReady],
  )

  const pauseForCalibration = useCallback(() => {
    videoRef.current?.pause()
    setPlaying(false)
  }, [])

  const handleCalibrationFrameStep = useCallback(
    (direction: -1 | 1) => {
      pauseForCalibration()
      handleScrub(playheadSeconds + direction * CALIBRATION_FRAME_SECONDS)
    },
    [handleScrub, pauseForCalibration, playheadSeconds],
  )

  const handleCalibrationCurbJump = useCallback(
    (direction: -1 | 1) => {
      pauseForCalibration()
      const contact = adjacentCurbContact(playheadSeconds, direction)
      handleScrub(
        (contact.startLapTimeSeconds + contact.endLapTimeSeconds) * 0.5,
      )
    },
    [handleScrub, pauseForCalibration, playheadSeconds],
  )

  const handleCalibrationNudge = useCallback(
    (delta: number) => {
      pauseForCalibration()
      setRacingLineAnchors((current) => {
        const nearby = nearestRacingLineAnchor(
          current,
          playheadSeconds,
          durationSeconds,
        )
        const currentDelta =
          nearby?.anchor.deltaMeters ??
          calibrationSample?.manualDeltaMeters ??
          racingLineDeltaAtLapTime(current, playheadSeconds, durationSeconds)
        return upsertRacingLineAnchor(
          current,
          playheadSeconds,
          currentDelta + delta,
          durationSeconds,
        )
      })
    },
    [
      calibrationSample?.manualDeltaMeters,
      durationSeconds,
      pauseForCalibration,
      playheadSeconds,
    ],
  )

  const handleCalibrationCenter = useCallback(() => {
    pauseForCalibration()
    setRacingLineAnchors((current) =>
      upsertRacingLineAnchor(current, playheadSeconds, 0, durationSeconds),
    )
  }, [durationSeconds, pauseForCalibration, playheadSeconds])

  const handleCalibrationRemove = useCallback(() => {
    pauseForCalibration()
    setRacingLineAnchors((current) =>
      removeNearestRacingLineAnchor(current, playheadSeconds, durationSeconds),
    )
  }, [durationSeconds, pauseForCalibration, playheadSeconds])

  const handleCalibrationReset = useCallback(() => {
    pauseForCalibration()
    setRacingLineAnchors(
      normalizeRacingLineAnchors(DEFAULT_RACING_LINE_ANCHORS, durationSeconds),
    )
  }, [durationSeconds, pauseForCalibration])

  const handleCalibrationCopy = useCallback(() => {
    void navigator.clipboard.writeText(
      JSON.stringify(racingLineAnchors, null, 2),
    )
  }, [racingLineAnchors])

  const displayedRoadFraction = calibrationSample?.roadFraction ?? 0.5
  const displayedDeltaMeters =
    calibrationSample?.manualDeltaMeters ??
    racingLineDeltaAtLapTime(
      racingLineAnchors,
      playheadSeconds,
      durationSeconds,
    )

  return (
    <div className={styles.app}>
      <div className={styles.scene} aria-label="Third-person track view">
        <TrackScene
          replay={replay}
          playheadSeconds={playheadSeconds}
          playing={playing}
          videoRef={videoRef}
          lapWindow={lapWindow}
          racingLineAnchors={racingLineAnchors}
          onCalibrationSample={
            calibrationMode ? setCalibrationSample : undefined
          }
        />
      </div>

      <section className={styles.onboard} aria-label="Onboard camera">
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
        <NavBar />
      </div>

      <div className={styles.playhead}>
        <Playhead
          playing={playing}
          disabled={!videoReady}
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
          playheadSeconds={playheadSeconds}
          durationSeconds={durationSeconds}
          roadFraction={displayedRoadFraction}
          deltaMeters={displayedDeltaMeters}
          curbLabel={calibrationSample?.curbLabel ?? null}
          curbSide={calibrationSample?.curbSide ?? null}
          curbWeight={calibrationSample?.curbWeight ?? 0}
          wheelOnCurb={calibrationSample?.wheelOnCurb ?? false}
          anchors={racingLineAnchors}
          onStepFrame={handleCalibrationFrameStep}
          onJumpCurb={handleCalibrationCurbJump}
          onNudge={handleCalibrationNudge}
          onCenter={handleCalibrationCenter}
          onRemove={handleCalibrationRemove}
          onReset={handleCalibrationReset}
          onCopy={handleCalibrationCopy}
        />
      ) : null}
    </div>
  )
}
