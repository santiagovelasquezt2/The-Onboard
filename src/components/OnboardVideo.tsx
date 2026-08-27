import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import styles from './OnboardVideo.module.css'
import {
  lapTimeFromVideoTime,
  lapTimelineStartSeconds,
  videoLapEndSeconds,
  type LapWindow,
} from '../lapWindow'

const VIDEO_SRC = '/media/onboard.mp4?v=20260821'

type OnboardVideoProps = {
  playing: boolean
  playbackRate: number
  lapWindow: LapWindow
  onLapTimeUpdate: (seconds: number) => void
  onPlayState: (playing: boolean) => void
  onSourceReady: (ready: boolean) => void
}

export const OnboardVideo = forwardRef<HTMLVideoElement | null, OnboardVideoProps>(
  function OnboardVideo(
    {
      playing,
      playbackRate,
      lapWindow,
      onLapTimeUpdate,
      onPlayState,
      onSourceReady,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [failureMessage, setFailureMessage] = useState<string | null>(null)
    const lapEndSeconds = videoLapEndSeconds(lapWindow)

    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement)

    const bindVideo = useCallback(
      (node: HTMLVideoElement | null) => {
        videoRef.current = node
        if (!node) onSourceReady(false)
      },
      [onSourceReady],
    )

    useEffect(() => {
      const video = videoRef.current
      if (!video || failureMessage) return

      if (playing) {
        void video.play().catch(() => onPlayState(false))
      } else {
        video.pause()
      }
    }, [playing, failureMessage, onPlayState])

    useEffect(() => {
      const video = videoRef.current
      if (video) video.playbackRate = playbackRate
    }, [playbackRate])

    const updateLapTime = useCallback(
      (video: HTMLVideoElement) => {
        const lapTime = lapTimeFromVideoTime(video.currentTime, lapWindow)

        // Only clamp when playing forward past the end — never yank currentTime
        // backward by more than a tiny epsilon (repeated assigns stutter).
        if (video.currentTime > lapEndSeconds + 0.05) {
          video.currentTime = lapEndSeconds
          onLapTimeUpdate(lapWindow.lapDurationSeconds)
          if (!video.paused) video.pause()
          return
        }
        if (video.currentTime >= lapEndSeconds) {
          onLapTimeUpdate(lapWindow.lapDurationSeconds)
          if (!video.paused) video.pause()
          return
        }

        onLapTimeUpdate(lapTime)
      },
      [lapEndSeconds, lapWindow, onLapTimeUpdate],
    )

    if (failureMessage) {
      return (
        <div className={styles.frame} data-empty>
          <div className={styles.xLines} aria-hidden />
          <div className={styles.placeholder}>
            <span className={styles.placeholderLabel}>Onboard Cam</span>
            <span className={styles.placeholderHint}>{failureMessage}</span>
          </div>
        </div>
      )
    }

    return (
      <div className={styles.frame}>
        <div className={styles.feedBadge} aria-hidden="true">
          <span className={styles.liveDot} />
          Onboard
          <strong>63</strong>
        </div>
        <video
          ref={bindVideo}
          className={styles.video}
          src={VIDEO_SRC}
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget
            const validWindow =
              Number.isFinite(video.duration) &&
              lapWindow.videoStartSeconds >= 0 &&
              lapWindow.lapDurationSeconds > 0 &&
              video.duration >= lapEndSeconds
            if (!validWindow) {
              console.error(
                '[onboard] source video is shorter than the configured lap window',
              )
              setFailureMessage(
                'This video does not contain the configured timed-lap window.',
              )
              onSourceReady(false)
              return
            }

            // Keep the source's turn-13 run-up. Only reset on first ready /
            // HMR — do not re-seek to 0 on every metadata event once playing.
            if (!Number.isFinite(video.currentTime) || video.currentTime < 0.001) {
              video.currentTime = 0
              onLapTimeUpdate(lapTimelineStartSeconds(lapWindow))
            }
            onSourceReady(true)
          }}
          onTimeUpdate={(e) => updateLapTime(e.currentTarget)}
          onSeeked={(e) => {
            updateLapTime(e.currentTarget)
          }}
          onPlay={() => onPlayState(true)}
          onPause={() => onPlayState(false)}
          onEnded={() => onPlayState(false)}
          onError={() => {
            setFailureMessage('Place footage at /media/onboard.mp4')
            onSourceReady(false)
          }}
        />
      </div>
    )
  },
)
