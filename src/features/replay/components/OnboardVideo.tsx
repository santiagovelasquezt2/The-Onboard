import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { RUNTIME_ASSETS } from '../../../runtimeAssets'
import styles from './OnboardVideo.module.css'
import {
  lapTimelineStartSeconds,
  videoLapEndSeconds,
  type LapWindow,
} from '../lapWindow'

export type OnboardVideoProps = {
  playing: boolean
  playbackRate: number
  lapWindow: LapWindow
  onLapTimeUpdate: (seconds: number) => void
  onPlayState: (playing: boolean) => void
  onSourceReady: (ready: boolean) => void
  /** A decoded image is ready for the PiP, distinct from metadata readiness. */
  onFrameReady?: (ready: boolean) => void
  onFrameError?: (message: string) => void
  /**
   * Undefined uses the environment contract. Null is an intentional
   * no-footage state suitable for a future local file picker.
   */
  sourceUrl?: string | null
  onSourceMissing?: () => void
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
      onFrameReady,
      onFrameError,
      sourceUrl,
      onSourceMissing,
      timelineEndExtensionSeconds = 0,
    },
    ref,
  ) {
    const configuredSourceUrl =
      sourceUrl === undefined ? RUNTIME_ASSETS.onboardVideoUrl : sourceUrl
    const resolvedSourceUrl = configuredSourceUrl?.trim() || null
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [failureMessage, setFailureMessage] = useState<string | null>(null)
    const frameReadyRef = useRef(false)
    const frameFailureRef = useRef(false)
    const previousSourceUrlRef = useRef(resolvedSourceUrl)
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

    useEffect(() => {
      if (previousSourceUrlRef.current === resolvedSourceUrl) return
      previousSourceUrlRef.current = resolvedSourceUrl
      frameFailureRef.current = false
      setFailureMessage(null)
    }, [resolvedSourceUrl])

    useEffect(() => {
      if (resolvedSourceUrl !== null) return
      onSourceReady(false)
      onFrameReady?.(false)
      onPlayState(false)
      onSourceMissing?.()
    }, [
      onFrameReady,
      onPlayState,
      onSourceMissing,
      onSourceReady,
      resolvedSourceUrl,
    ])

    const confirmSourceReady = useCallback(
      (video: HTMLVideoElement) => {
        const validWindow =
          Number.isFinite(video.duration) &&
          lapWindow.videoStartSeconds >= 0 &&
          lapWindow.lapDurationSeconds > 0 &&
          video.duration >= lapEndSeconds
        if (!validWindow) {
          const message =
            'The onboard video does not contain the configured timed-lap window.'
          console.error(
            '[onboard] source video is shorter than the configured lap window',
          )
          setFailureMessage(message)
          frameFailureRef.current = true
          onSourceReady(false)
          onFrameReady?.(false)
          onFrameError?.(message)
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
      [
        lapEndSeconds,
        lapWindow,
        onFrameError,
        onFrameReady,
        onLapTimeUpdate,
        onSourceReady,
      ],
    )

    const confirmFrameReady = useCallback(
      (video: HTMLVideoElement) => {
        if (
          frameReadyRef.current ||
          frameFailureRef.current ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return
        }

        let reported = false
        const report = () => {
          if (
            reported ||
            frameReadyRef.current ||
            frameFailureRef.current ||
            videoRef.current !== video ||
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            return
          }
          reported = true
          frameReadyRef.current = true
          onFrameReady?.(true)
        }
        // A video-frame callback proves compositor delivery when the browser
        // produces one. Paused cached video can already have presented its
        // first image before a callback is registered, so `loadeddata` plus a
        // yielded paint is the valid fallback: it only runs after a decoded
        // frame exists and never uses a time-based escape hatch.
        if (typeof video.requestVideoFrameCallback === 'function') {
          video.requestVideoFrameCallback(report)
        }
        window.requestAnimationFrame(report)
      },
      [onFrameReady],
    )

    const bindVideo = useCallback(
      (node: HTMLVideoElement | null) => {
        videoRef.current = node
        if (!node) {
          frameReadyRef.current = false
          onSourceReady(false)
          onFrameReady?.(false)
          return
        }
        // StrictMode can detach and reattach an already-cached media node
        // after `loadedmetadata` fired. Restore readiness from the node itself.
        if (node.readyState >= HTMLMediaElement.HAVE_METADATA) {
          confirmSourceReady(node)
        }
        if (node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          confirmFrameReady(node)
        }
      },
      [confirmFrameReady, confirmSourceReady, onFrameReady, onSourceReady],
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

    if (resolvedSourceUrl === null || failureMessage) {
      const placeholderMessage =
        failureMessage ?? 'Choose onboard footage to start the synchronized lap.'
      return (
        <div className={styles.frame} data-empty>
          <div className={styles.xLines} aria-hidden />
          <div className={styles.placeholder}>
            <span className={styles.placeholderLabel}>Onboard Cam</span>
            <span className={styles.placeholderHint}>{placeholderMessage}</span>
          </div>
        </div>
      )
    }

    return (
      <div className={styles.frame}>
        <video
          key={resolvedSourceUrl}
          ref={bindVideo}
          className={styles.video}
          src={resolvedSourceUrl}
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => confirmSourceReady(event.currentTarget)}
          onLoadedData={(event) => confirmFrameReady(event.currentTarget)}
          onCanPlay={(event) => confirmFrameReady(event.currentTarget)}
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
            const message = 'The onboard video could not be loaded.'
            setFailureMessage(message)
            frameReadyRef.current = false
            frameFailureRef.current = true
            onSourceReady(false)
            onFrameReady?.(false)
            onFrameError?.(message)
          }}
        />
      </div>
    )
  },
)
