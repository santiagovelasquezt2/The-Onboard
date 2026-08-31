import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type AnimationEvent,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import styles from './ReplayEntryLoader.module.css'

const MINIMUM_HAND_TAP_CYCLES = 2
const EXIT_ANIMATION_FALLBACK_MS = 1000

export type ReplayEntryLoaderProps = {
  ready?: boolean
  failure?: string | null
  onExitComplete?: () => void
  onRetry?: () => void
  onChooseVideo?: (file: File) => void
}

/**
 * Full-screen replay entry gate. It remains mounted until the replay data,
 * decoded onboard frame, and completed WebGL scene frame have all arrived.
 */
export function ReplayEntryLoader({
  ready = false,
  failure = null,
  onExitComplete,
  onRetry,
  onChooseVideo,
}: ReplayEntryLoaderProps) {
  const completedTapCyclesRef = useRef(0)
  const exitReportedRef = useRef(false)
  const failureContentRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const retryButtonRef = useRef<HTMLButtonElement | null>(null)
  const failureTitleId = useId()
  const failureMessageId = useId()
  const [exiting, setExiting] = useState(false)
  const handleFinalFingerIteration = useCallback(() => {
    if (failure) return
    completedTapCyclesRef.current += 1
    if (
      ready &&
      completedTapCyclesRef.current >= MINIMUM_HAND_TAP_CYCLES
    ) {
      setExiting(true)
    }
  }, [failure, ready])
  const reportExitComplete = useCallback(() => {
    if (!onExitComplete || exitReportedRef.current) return

    exitReportedRef.current = true
    onExitComplete()
  }, [onExitComplete])
  const handleGateAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLDivElement>) => {
      if (
        failure ||
        !exiting ||
        event.currentTarget !== event.target ||
        !event.animationName.includes('telescopeExit')
      ) {
        return
      }

      reportExitComplete()
    },
    [exiting, failure, reportExitComplete],
  )

  const handleVideoSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      if (file) onChooseVideo?.(file)
      event.currentTarget.value = ''
    },
    [onChooseVideo],
  )

  const handleFailureKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!failure || event.key !== 'Tab') return

      const container = failureContentRef.current
      if (!container) return
      const focusableElements = Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled])',
        ),
      )
      if (focusableElements.length === 0) {
        event.preventDefault()
        container.focus({ preventScroll: true })
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      if (
        event.shiftKey &&
        (activeElement === firstElement || !container.contains(activeElement))
      ) {
        event.preventDefault()
        lastElement.focus()
      } else if (
        !event.shiftKey &&
        (activeElement === lastElement || !container.contains(activeElement))
      ) {
        event.preventDefault()
        firstElement.focus()
      }
    },
    [failure],
  )

  useEffect(() => {
    if (failure || !ready || !onExitComplete || !window.matchMedia) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finishWithoutMotion = () => {
      if (reducedMotion.matches) reportExitComplete()
    }
    finishWithoutMotion()
    reducedMotion.addEventListener('change', finishWithoutMotion)
    return () => {
      reducedMotion.removeEventListener('change', finishWithoutMotion)
    }
  }, [failure, onExitComplete, ready, reportExitComplete])

  useEffect(() => {
    if (failure || !exiting || !onExitComplete) return

    const timeoutId = window.setTimeout(
      reportExitComplete,
      EXIT_ANIMATION_FALLBACK_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [exiting, failure, onExitComplete, reportExitComplete])

  useEffect(() => {
    if (!failure) return

    const focusTarget =
      fileInputRef.current ??
      retryButtonRef.current ??
      failureContentRef.current
    focusTarget?.focus({ preventScroll: true })
  }, [failure, onChooseVideo, onRetry])

  const visiblyExiting = exiting && !failure

  return (
    <div
      className={styles.gate}
      role={failure ? 'alertdialog' : 'status'}
      aria-modal={failure ? true : undefined}
      aria-labelledby={failure ? failureTitleId : undefined}
      aria-describedby={failure ? failureMessageId : undefined}
      aria-live={failure ? undefined : 'polite'}
      aria-busy={!failure}
      onKeyDown={handleFailureKeyDown}
    >
      <div
        className={`${styles.surface} ${
          visiblyExiting ? styles.surfaceExiting : ''
        }`}
        onAnimationEnd={handleGateAnimationEnd}
      >
        {failure ? (
          <div
            ref={failureContentRef}
            className={styles.failureContent}
            tabIndex={-1}
          >
            <p className={styles.failureEyebrow}>Replay unavailable</p>
            <h1 className={styles.failureTitle} id={failureTitleId}>
              Couldn’t start this lap
            </h1>
            <p className={styles.failureMessage} id={failureMessageId}>
              {failure}
            </p>
            <div className={styles.actions}>
              {onChooseVideo ? (
                <label className={`${styles.action} ${styles.primaryAction}`}>
                  Choose local MP4
                  <input
                    ref={fileInputRef}
                    className={styles.fileInput}
                    type="file"
                    accept="video/mp4,.mp4"
                    onChange={handleVideoSelection}
                  />
                </label>
              ) : null}
              {onRetry ? (
                <button
                  ref={retryButtonRef}
                  className={`${styles.action} ${
                    onChooseVideo
                      ? styles.secondaryAction
                      : styles.primaryAction
                  }`}
                  type="button"
                  onClick={onRetry}
                >
                  Retry
                </button>
              ) : null}
              <a
                className={`${styles.action} ${styles.secondaryAction}`}
                href="/"
              >
                Home
              </a>
            </div>
            {onChooseVideo ? (
              <p className={styles.localVideoHint}>
                Your selected file stays on this device.
              </p>
            ) : null}
          </div>
        ) : (
          <div className={styles.content}>
            <div className={styles.hand} aria-hidden="true">
              <div className={`${styles.finger} ${styles.fingerOne}`} />
              <div className={`${styles.finger} ${styles.fingerTwo}`} />
              <div className={`${styles.finger} ${styles.fingerThree}`} />
              <div
                className={`${styles.finger} ${styles.fingerFour}`}
                onAnimationIteration={handleFinalFingerIteration}
              />
              <div className={styles.palm} />
              <div className={styles.thumb} />
            </div>
            <p className={styles.loading}>Loading</p>
          </div>
        )}
      </div>
    </div>
  )
}
