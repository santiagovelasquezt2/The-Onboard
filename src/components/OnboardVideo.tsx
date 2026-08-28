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
  /** Optional source-video tail used when the visible onboard leads the car. */
  timelineEndExtensionSeconds?: number
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
      timelineEndExtensionSeconds = 0,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [failureMessage, setFailureMessage] = useState<string | null>(null)
    const timelineEndExtension = Math.max(
      0,
      Number.isFinite(timelineEndExtensionSeconds)
        ? timelineEndExtensionSeconds
        : 0,
    )
    const extendedLapEndTime =
      lapWindow.lapDurationSeconds + timelineEndExtension
    const lapEndSeconds = videoLapEndSeconds(lapWindow) + timelineEndExtension

    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement)

    const confirmSourceReady = useCallback(
      (video: HTMLVideoElement) => {
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

        // Keep the source's turn-13 run-up. Only reset on first ready / HMR —
        // do not re-seek to 0 on every metadata event once playing.
        if (!Number.isFinite(video.currentTime) || video.currentTime < 0.001) {
          video.currentTime = 0
          onLapTimeUpdate(lapTimelineStartSeconds(lapWindow))
        }
        onSourceReady(true)
      },
      [lapEndSeconds, lapWindow, onLapTimeUpdate, onSourceReady],
    )

    const bindVideo = useCallback(
      (node: HTMLVideoElement | null) => {
        videoRef.current = node
        if (!node) {
          onSourceReady(false)
          return
        }
        // StrictMode can detach and reattach an already-cached media node
        // after `loadedmetadata` fired. Restore readiness from the node itself.
        if (node.readyState >= HTMLMediaElement.HAVE_METADATA) {
          confirmSourceReady(node)
        }
      },
      [confirmSourceReady, onSourceReady],
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

    const stopAtLapEnd = useCallback(
      (video: HTMLVideoElement) => {
        if (video.currentTime < lapEndSeconds) return false

        if (video.currentTime > lapEndSeconds) video.currentTime = lapEndSeconds
        onLapTimeUpdate(extendedLapEndTime)
        if (!video.paused) video.pause()
        return true
      },
      [extendedLapEndTime, lapEndSeconds, onLapTimeUpdate],
    )

    const updateLapTime = useCallback(
      (video: HTMLVideoElement) => {
        if (stopAtLapEnd(video)) return

        const sourceLapTime = video.currentTime - lapWindow.videoStartSeconds
        const timelineStart = -Math.max(0, lapWindow.videoStartSeconds)
        onLapTimeUpdate(
          Math.min(
            extendedLapEndTime,
            Math.max(timelineStart, sourceLapTime),
          ),
        )
      },
      [extendedLapEndTime, lapWindow.videoStartSeconds, onLapTimeUpdate, stopAtLapEnd],
    )

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      let videoFrameCallbackId: number | null = null
      let animationFrameId: number | null = null

      const checkBoundary = () => {
        videoFrameCallbackId = null
        animationFrameId = null
        if (stopAtLapEnd(video) || video.paused || video.ended) return
        scheduleBoundaryCheck()
      }
      const scheduleBoundaryCheck = () => {
        if (videoFrameCallbackId !== null || animationFrameId !== null) return
        if (typeof video.requestVideoFrameCallback === 'function') {
          videoFrameCallbackId = video.requestVideoFrameCallback(checkBoundary)
        } else {
          animationFrameId = window.requestAnimationFrame(checkBoundary)
        }
      }
      const handlePlay = () => scheduleBoundaryCheck()

      video.addEventListener('play', handlePlay)
      if (!video.paused) scheduleBoundaryCheck()
      return () => {
        video.removeEventListener('play', handlePlay)
        if (videoFrameCallbackId !== null) {
          video.cancelVideoFrameCallback(videoFrameCallbackId)
        }
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId)
        }
      }
    }, [stopAtLapEnd])

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
          onLoadedMetadata={(event) => confirmSourceReady(event.currentTarget)}
          onTimeUpdate={(e) => updateLapTime(e.currentTarget)}
          onSeeked={(e) => {
            updateLapTime(e.currentTarget)
          }}
          onPlay={() => onPlayState(true)}
          onPause={(event) => {
            updateLapTime(event.currentTarget)
            onPlayState(false)
          }}
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
