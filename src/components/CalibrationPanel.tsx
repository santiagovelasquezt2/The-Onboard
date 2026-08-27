import {
  nearestRacingLineAnchor,
  type RacingLineAnchor,
} from '../racingLineCalibration'
import type { CurbSide } from '../curbContacts'
import styles from './CalibrationPanel.module.css'

type CalibrationPanelProps = {
  playheadSeconds: number
  durationSeconds: number
  roadFraction: number
  deltaMeters: number
  curbLabel: string | null
  curbSide: CurbSide | null
  curbWeight: number
  wheelOnCurb: boolean
  anchors: readonly RacingLineAnchor[]
  onStepFrame: (direction: -1 | 1) => void
  onJumpCurb: (direction: -1 | 1) => void
  onNudge: (delta: number) => void
  onCenter: () => void
  onRemove: () => void
  onReset: () => void
  onCopy: () => void
}

function formatSeconds(seconds: number) {
  return `${seconds < 0 ? '-' : ''}${Math.abs(seconds).toFixed(2)}s`
}

export function CalibrationPanel({
  playheadSeconds,
  durationSeconds,
  roadFraction,
  deltaMeters,
  curbLabel,
  curbSide,
  curbWeight,
  wheelOnCurb,
  anchors,
  onStepFrame,
  onJumpCurb,
  onNudge,
  onCenter,
  onRemove,
  onReset,
  onCopy,
}: CalibrationPanelProps) {
  const nearby = nearestRacingLineAnchor(
    anchors,
    playheadSeconds,
    durationSeconds,
  )
  const percentage = Math.round(Math.min(1, Math.max(0, roadFraction)) * 100)
  const formattedDelta = `${deltaMeters >= 0 ? '+' : ''}${deltaMeters.toFixed(2)} m`

  return (
    <aside className={styles.panel} aria-label="Racing line calibration">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Line calibration</p>
          <p className={styles.time}>{formatSeconds(playheadSeconds)}</p>
        </div>
        <span className={nearby ? styles.saved : styles.unsaved}>
          {nearby ? 'Anchor' : 'New point'}
        </span>
      </div>

      <div className={styles.position}>
        <span>L</span>
        <div className={styles.positionTrack}>
          <span style={{ left: `${percentage}%` }} />
        </div>
        <span>R</span>
        <strong>{percentage}%</strong>
      </div>

      <p className={styles.delta}>
        Manual correction <strong>{formattedDelta}</strong>
      </p>

      {curbLabel ? (
        <div className={styles.curbStatus}>
          <span>
            {curbLabel} · {curbSide}
          </span>
          <strong className={wheelOnCurb ? styles.curbHit : styles.curbMiss}>
            {curbWeight >= 0.99
              ? wheelOnCurb
                ? 'On curb'
                : curbWeight >= 0.5
                  ? 'White line'
                  : 'Approach'
              : 'Approach'}
          </strong>
        </div>
      ) : null}

      <div className={styles.curbSteps}>
        <button type="button" onClick={() => onJumpCurb(-1)}>
          Prev curb
        </button>
        <button type="button" onClick={() => onJumpCurb(1)}>
          Next curb
        </button>
      </div>

      <div className={styles.frameSteps}>
        <button type="button" onClick={() => onStepFrame(-1)}>
          −1 frame
        </button>
        <button type="button" onClick={() => onStepFrame(1)}>
          +1 frame
        </button>
      </div>

      <div className={styles.nudges}>
        <button type="button" onClick={() => onNudge(-0.25)}>
          ← 0.25 m
        </button>
        <button type="button" onClick={() => onNudge(0.25)}>
          0.25 m →
        </button>
      </div>

      <div className={styles.fineNudges}>
        <button type="button" onClick={() => onNudge(-0.05)}>
          −0.05 m
        </button>
        <button type="button" onClick={onCenter}>
          Clear nudge
        </button>
        <button type="button" onClick={() => onNudge(0.05)}>
          +0.05 m
        </button>
      </div>

      <p className={styles.hint}>
        Audited curb windows target the matching wheel automatically. Pause or
        scrub to any other frame to add a local groove correction.
      </p>

      <div className={styles.actions}>
        <button type="button" onClick={onRemove} disabled={!nearby}>
          Remove point
        </button>
        <button type="button" onClick={onCopy}>
          Copy JSON
        </button>
        <button type="button" onClick={onReset}>
          Reset nudges
        </button>
      </div>

      <p className={styles.count}>{anchors.length} saved anchors</p>
    </aside>
  )
}
