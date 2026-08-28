import { useState, type PointerEvent } from 'react'
import {
  CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  CALIBRATION_CAMERA_MAX_HEIGHT_METERS,
  CALIBRATION_CAMERA_MIN_HEIGHT_METERS,
} from '../calibrationCamera'
import {
  calibrationSectionProgress,
  type CalibrationSection,
} from '../calibrationSections'
import { viewerRoadFraction } from '../calibrationControls'
import styles from './CalibrationPanel.module.css'

export type CalibrationRunMode = 'ready' | 'recording' | 'reviewing'

type CalibrationPanelProps = {
  section: CalibrationSection
  sectionIndex: number
  sections: readonly CalibrationSection[]
  savedSectionIds: readonly string[]
  saved: boolean
  mode: CalibrationRunMode
  playheadSeconds: number
  entryOffsetMeters: number
  roadFraction: number
  entrySource: 'automatic' | 'inherited' | 'adjusted'
  boundaryLimited: boolean
  recordingAvailable: boolean
  reviewAvailable: boolean
  atSectionStart: boolean
  playing: boolean
  cameraView: 'overhead' | 'onboard'
  onSelectSection: (index: number) => void
  onReturnToStart: () => void
  onNudgeEntry: (deltaMeters: number) => void
  onCameraHeightChange: (heightMeters: number) => void
  onCameraViewChange: (view: 'overhead' | 'onboard') => void
  onStartRecording: () => void
  onCancelRecording: () => void
  onReview: () => void
  onStopReview: () => void
  onSteerStart: (direction: -1 | 1) => void
  onSteerEnd: () => void
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${tenths}`
}

function entrySourceLabel(source: CalibrationPanelProps['entrySource']) {
  if (source === 'inherited') return 'From previous exit'
  if (source === 'adjusted') return 'Shared boundary edit'
  return 'Automatic starting line'
}

export function CalibrationPanel({
  section,
  sectionIndex,
  sections,
  savedSectionIds,
  saved,
  mode,
  playheadSeconds,
  entryOffsetMeters,
  roadFraction,
  entrySource,
  boundaryLimited,
  recordingAvailable,
  reviewAvailable,
  atSectionStart,
  playing,
  cameraView,
  onSelectSection,
  onReturnToStart,
  onNudgeEntry,
  onCameraHeightChange,
  onCameraViewChange,
  onStartRecording,
  onCancelRecording,
  onReview,
  onStopReview,
  onSteerStart,
  onSteerEnd,
}: CalibrationPanelProps) {
  const [cameraHeightMeters, setCameraHeightMeters] = useState(
    CALIBRATION_CAMERA_DEFAULT_HEIGHT_METERS,
  )
  const recording = mode === 'recording'
  const reviewing = mode === 'reviewing'
  const busy = recording || reviewing
  const percentage = Math.round(viewerRoadFraction(roadFraction) * 100)
  const formattedOffset = `${entryOffsetMeters >= 0 ? '+' : ''}${entryOffsetMeters.toFixed(2)} m`
  const sectionProgress = calibrationSectionProgress(playheadSeconds, section)
  const sectionProgressPercent = Math.round(sectionProgress * 100)
  const sectionDurationSeconds =
    section.endLapTimeSeconds - section.startLapTimeSeconds
  const sectionElapsedSeconds = sectionProgress * sectionDurationSeconds

  const steerPointerDown = (
    direction: -1 | 1,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSteerStart(direction)
  }

  return (
    <aside className={styles.panel} aria-label="Section racing-line recorder">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            Section {sectionIndex + 1} of {sections.length}
          </p>
          <h2>{section.label}</h2>
          <p className={styles.range}>
            {formatTime(section.startLapTimeSeconds)} –{' '}
            {formatTime(section.endLapTimeSeconds)}
          </p>
        </div>
        <span
          className={
            recording
              ? styles.recording
              : reviewing
                ? styles.reviewing
                : saved
                  ? styles.saved
                  : styles.ready
          }
          aria-live="polite"
        >
          {recording
            ? 'Recording'
            : reviewing
              ? 'Reviewing'
              : saved
                ? 'Saved'
                : 'Ready'}
        </span>
      </div>

      <nav className={styles.sectionGrid} aria-label="Calibration sections">
        {sections.map((candidate, index) => {
          const selected = index === sectionIndex
          const sectionSaved = savedSectionIds.includes(candidate.id)
          return (
            <button
              key={candidate.id}
              type="button"
              className={`${styles.sectionCard} ${
                selected ? styles.sectionCardActive : ''
              } ${sectionSaved ? styles.sectionCardSaved : ''}`}
              onClick={() => onSelectSection(index)}
              disabled={busy}
              aria-current={selected ? 'step' : undefined}
              aria-label={`Open section ${index + 1}: ${candidate.label}${
                sectionSaved ? ' (saved)' : ''
              }`}
            >
              <span className={styles.sectionNumber}>{index + 1}</span>
              <span className={styles.sectionName}>{candidate.shortLabel}</span>
              <span className={styles.sectionCheck} aria-hidden="true">
                {sectionSaved ? '✓' : ''}
              </span>
            </button>
          )
        })}
      </nav>

      <div className={styles.sectionProgress}>
        <div className={styles.positionLabel}>
          <span>Section progress</span>
          <strong>{sectionProgressPercent}%</strong>
        </div>
        <div
          className={styles.sectionProgressTrack}
          role="progressbar"
          aria-label={`${section.label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sectionProgressPercent}
          aria-valuetext={`${formatTime(sectionElapsedSeconds)} of ${formatTime(sectionDurationSeconds)}`}
        >
          <span
            className={styles.sectionProgressFill}
            style={{ transform: `scaleX(${sectionProgress})` }}
          />
        </div>
        <div className={styles.positionEnds} aria-hidden="true">
          <span>{formatTime(sectionElapsedSeconds)}</span>
          <span>{formatTime(sectionDurationSeconds)}</span>
        </div>
      </div>

      <div className={styles.zoom}>
        <div className={styles.positionLabel}>
          <span>Camera distance</span>
          <strong>{Math.round(cameraHeightMeters)} m</strong>
        </div>
        <input
          className={styles.zoomRange}
          type="range"
          min={CALIBRATION_CAMERA_MIN_HEIGHT_METERS}
          max={CALIBRATION_CAMERA_MAX_HEIGHT_METERS}
          step={1}
          value={cameraHeightMeters}
          aria-label="Camera distance"
          disabled={cameraView === 'onboard'}
          onChange={(event) => {
            const nextHeightMeters = Number(event.currentTarget.value)
            setCameraHeightMeters(nextHeightMeters)
            onCameraHeightChange(nextHeightMeters)
          }}
        />
        <div className={styles.positionEnds}>
          <span>Closer</span>
          <span>Farther</span>
        </div>
      </div>

      <div className={styles.view}>
        <div className={styles.positionLabel}>
          <span>3D view</span>
          <strong>
            {cameraView === 'overhead' ? 'Positioning' : 'Onboard comparison'}
          </strong>
        </div>
        <button
          type="button"
          className={styles.compare}
          onClick={() =>
            onCameraViewChange(
              cameraView === 'overhead' ? 'onboard' : 'overhead',
            )
          }
          aria-pressed={cameraView === 'onboard'}
        >
          {cameraView === 'overhead'
            ? 'Compare 3D onboard'
            : 'Back to positioning view'}
        </button>
        {cameraView === 'onboard' ? (
          <p className={styles.viewHint}>
            The real onboard remains in the upper-left for a direct comparison.
          </p>
        ) : recording ? (
          <p className={styles.viewHint}>
            Switch views at any time without interrupting this take.
          </p>
        ) : null}
      </div>

      <div className={styles.position}>
        <div className={styles.positionLabel}>
          <span>Section entry</span>
          <strong>{formattedOffset}</strong>
        </div>
        <div className={styles.positionTrack} aria-hidden="true">
          <span style={{ left: `${percentage}%` }} />
        </div>
        <div className={styles.positionEnds}>
          <span>Left</span>
          <span>Right</span>
        </div>
      </div>

      <p className={styles.inheritance}>{entrySourceLabel(entrySource)}</p>
      {boundaryLimited ? (
        <p className={styles.boundary}>Two-wheel white-line limit reached</p>
      ) : null}

      {recording ? (
        <>
          <p className={styles.status}>
            {playing
              ? `Driving to ${formatTime(section.endLapTimeSeconds)}. It saves there automatically.`
              : 'Paused. Compare the 3D onboard with the real footage, then press play to continue this take.'}
          </p>
          <div className={styles.steering}>
            <button
              type="button"
              onPointerDown={(event) => steerPointerDown(-1, event)}
              onPointerUp={onSteerEnd}
              onPointerCancel={onSteerEnd}
              onLostPointerCapture={onSteerEnd}
              aria-label="Steer car left"
              disabled={!playing}
            >
              ← Hold left
            </button>
            <button
              type="button"
              onPointerDown={(event) => steerPointerDown(1, event)}
              onPointerUp={onSteerEnd}
              onPointerCancel={onSteerEnd}
              onLostPointerCapture={onSteerEnd}
              aria-label="Steer car right"
              disabled={!playing}
            >
              Hold right →
            </button>
          </div>
          <button
            type="button"
            className={styles.quiet}
            onClick={onCancelRecording}
          >
            Cancel this take
          </button>
          <p className={styles.hint}>
            Hold A/D or ←/→ to steer. Releasing holds the car where it is.
          </p>
        </>
      ) : reviewing ? (
        <>
          <p className={styles.status}>
            Replaying only this section. It pauses at the end.
          </p>
          <button type="button" className={styles.quiet} onClick={onStopReview}>
            Stop review
          </button>
        </>
      ) : (
        <>
          {!atSectionStart ? (
            <button
              type="button"
              className={styles.return}
              onClick={onReturnToStart}
            >
              Return to section start
            </button>
          ) : (
            <>
              <div className={styles.nudges}>
                <button
                  type="button"
                  onClick={() => onNudgeEntry(-0.25)}
                  disabled={!recordingAvailable}
                  aria-label="Move section entry left"
                >
                  ← Move left
                </button>
                <button
                  type="button"
                  onClick={() => onNudgeEntry(0.25)}
                  disabled={!recordingAvailable}
                  aria-label="Move section entry right"
                >
                  Move right →
                </button>
              </div>
              <button
                type="button"
                className={styles.primary}
                onClick={onStartRecording}
                disabled={!recordingAvailable}
              >
                {saved ? 'Redo section' : 'Record section'}
              </button>
            </>
          )}

          {saved ? (
            <div className={styles.savedActions}>
              <button
                type="button"
                onClick={onReview}
                disabled={!reviewAvailable}
              >
                Review section
              </button>
              <button
                type="button"
                onClick={() => onSelectSection(sectionIndex + 1)}
                disabled={sectionIndex === sections.length - 1}
              >
                Next section →
              </button>
            </div>
          ) : null}

          <p className={styles.hint}>
            Every section starts where the last one ended. Pause here and use
            left/right to change that shared boundary before recording. You can
            put the outside pair over the white line; the opposite pair stays
            inside.
          </p>
        </>
      )}
    </aside>
  )
}
