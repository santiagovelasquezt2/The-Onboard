import type { PointerEvent } from 'react'
import {
  CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX,
  CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN,
  calibrationCameraDistanceControlFromHeight,
  calibrationCameraHeightFromDistanceControl,
} from '../calibrationCamera'
import {
  DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS,
  DRIVING_LINE_COMPARISON_OFFSET_MAX_SECONDS,
  DRIVING_LINE_COMPARISON_OFFSET_MIN_SECONDS,
  DRIVING_LINE_COMPARISON_OFFSET_STEP_SECONDS,
} from '../drivingLineComparisonTiming'
import {
  DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT,
  DRIVING_LINE_LAB_MINIMUM_CONTACT_SLOT_COUNT,
  type DrivingLineContactSlot,
  type DrivingLineRun,
  type DrivingLineSurface,
} from '../drivingLineLab'
import styles from './DrivingLineLabPanel.module.css'

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; path: string }
  | { status: 'error'; message: string }

type DrivingLineLabPanelProps = {
  runs: readonly DrivingLineRun[]
  selectedRun: DrivingLineRun
  selectedContactSlot: DrivingLineContactSlot
  surface: DrivingLineSurface
  playing: boolean
  ready: boolean
  playheadSeconds: number
  durationSeconds: number
  offsetMeters: number
  roadFraction: number
  boundaryLimited: boolean
  cameraView: 'overhead' | 'onboard'
  videoLeadSeconds: number
  comparisonOffsetSeconds: number
  cameraHeightMeters: number
  saveState: SaveState
  canUndo: boolean
  onSelectRun: (runId: string) => void
  onSelectContactSlot: (contactSlot: DrivingLineContactSlot) => void
  onNewRun: () => void
  onAddContactSlot: () => void
  onRemoveContactSlot: () => void
  onSurfaceChange: (surface: DrivingLineSurface) => void
  onMark: () => void
  onUndo: () => void
  onSaveWorkspace: () => void
  onDownload: () => void
  onCameraViewChange: (view: 'overhead' | 'onboard') => void
  onCameraHeightChange: (heightMeters: number) => void
  onComparisonOffsetChange: (seconds: number) => void
  onForwardStart: () => void
  onForwardEnd: () => void
  onStepBackward: () => void
  onLateralStart: (direction: -1 | 1) => void
  onLateralEnd: () => void
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const minutes = Math.floor(safe / 60)
  const remainder = safe - minutes * 60
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`
}

function surfaceLabel(surface: DrivingLineSurface) {
  if (surface === 'curb') return 'Curb'
  if (surface === 'ref-point') return 'Ref point'
  return 'White line'
}

export function DrivingLineLabPanel({
  runs,
  selectedRun,
  selectedContactSlot,
  surface,
  playing,
  ready,
  playheadSeconds,
  durationSeconds,
  offsetMeters,
  roadFraction,
  boundaryLimited,
  cameraView,
  videoLeadSeconds,
  comparisonOffsetSeconds,
  cameraHeightMeters,
  saveState,
  canUndo,
  onSelectRun,
  onSelectContactSlot,
  onNewRun,
  onAddContactSlot,
  onRemoveContactSlot,
  onSurfaceChange,
  onMark,
  onUndo,
  onSaveWorkspace,
  onDownload,
  onCameraViewChange,
  onCameraHeightChange,
  onComparisonOffsetChange,
  onForwardStart,
  onForwardEnd,
  onStepBackward,
  onLateralStart,
  onLateralEnd,
}: DrivingLineLabPanelProps) {
  const progress = Math.min(
    1,
    Math.max(0, durationSeconds > 0 ? playheadSeconds / durationSeconds : 0),
  )
  const progressPercent = Math.round(progress * 100)
  const viewerRoadPercent = Math.round(
    Math.min(1, Math.max(0, roadFraction)) * 100,
  )
  const formattedOffset = `${offsetMeters >= 0 ? '+' : ''}${offsetMeters.toFixed(2)} m`
  const cameraDistanceControl = Math.round(
    calibrationCameraDistanceControlFromHeight(cameraHeightMeters),
  )
  const contactSlots = Array.from(
    { length: selectedRun.contactSlotCount },
    (_, index) => (index + 1) as DrivingLineContactSlot,
  )
  const marksByContactSlot = new Map(
    selectedRun.marks
      .filter(
        (mark) =>
          Number.isInteger(mark.contactSlot) &&
          mark.contactSlot >= 1 &&
          mark.contactSlot <= selectedRun.contactSlotCount,
      )
      .map((mark) => [mark.contactSlot, mark] as const),
  )
  const savedContactCount = marksByContactSlot.size
  const passComplete = savedContactCount === selectedRun.contactSlotCount
  const selectedContactMark = marksByContactSlot.get(selectedContactSlot)

  const capturePointer = (
    event: PointerEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    action()
  }

  return (
    <aside
      className={styles.panel}
      aria-label="Driving Line Lab"
      tabIndex={0}
      onClickCapture={(event) => {
        if (event.detail === 0) return
        const target = event.target
        if (
          target instanceof HTMLElement &&
          target.closest('button, input, select')
        ) {
          event.currentTarget.focus({ preventScroll: true })
        }
      }}
    >
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Separate calibration tool</p>
          <h1>Driving Line Lab</h1>
        </div>
        <span
          className={styles.markCount}
          aria-label={`${passComplete ? 'Pass complete, ' : ''}${savedContactCount} of ${selectedRun.contactSlotCount} contacts saved`}
          aria-live="polite"
        >
          {passComplete ? 'Complete · ' : ''}
          {savedContactCount}/{selectedRun.contactSlotCount}
        </span>
      </div>

      <p className={styles.isolation}>
        Existing section calibration stays untouched. Green shows only this
        pass’s raw local preview; final smoothing happens after review.
      </p>

      <div className={styles.fieldRow}>
        <label htmlFor="line-lab-run">Visible pass</label>
        <select
          id="line-lab-run"
          value={selectedRun.id}
          onChange={(event) => onSelectRun(event.currentTarget.value)}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name} · {run.marks.length}/{run.contactSlotCount}
            </option>
          ))}
        </select>
      </div>

      <button type="button" className={styles.quiet} onClick={onNewRun}>
        Start a new pass
      </button>

      <section
        className={styles.contactBoard}
        aria-labelledby="line-lab-contact-board"
      >
        <div className={styles.labelRow}>
          <span id="line-lab-contact-board">Contact board</span>
          <strong>
            {savedContactCount}/{selectedRun.contactSlotCount}
            {passComplete ? ' · complete' : ' saved'}
          </strong>
        </div>
        <div className={styles.contactGrid}>
          {contactSlots.map((contactSlot) => {
            const savedMark = marksByContactSlot.get(contactSlot)
            const active = contactSlot === selectedContactSlot
            const savedSurface = savedMark?.surface
            const savedDescription = savedMark
              ? `${surfaceLabel(savedMark.surface).toLowerCase()} saved at ${formatTime(savedMark.sourceLapTimeSeconds)}`
              : 'empty'

            return (
              <button
                key={contactSlot}
                type="button"
                className={styles.contactSlot}
                data-active={active ? 'true' : undefined}
                data-marked={savedMark ? 'true' : undefined}
                data-surface={savedSurface}
                aria-label={`Contact ${contactSlot}, ${savedDescription}${active ? ', selected' : ''}`}
                aria-pressed={active}
                onClick={() => onSelectContactSlot(contactSlot)}
              >
                {contactSlot}
              </button>
            )
          })}
        </div>
        <div className={styles.contactLegend} aria-hidden="true">
          <span data-surface="white-line">White line</span>
          <span data-surface="curb">Curb</span>
          <span data-surface="ref-point">Ref point</span>
        </div>
        <div className={styles.boardActions}>
          <button
            type="button"
            onClick={onAddContactSlot}
            disabled={
              selectedRun.contactSlotCount >=
              DRIVING_LINE_LAB_MAXIMUM_CONTACT_SLOT_COUNT
            }
          >
            Add contact box
          </button>
          <button
            type="button"
            onClick={onRemoveContactSlot}
            disabled={
              selectedRun.contactSlotCount <=
              DRIVING_LINE_LAB_MINIMUM_CONTACT_SLOT_COUNT
            }
          >
            Remove #{selectedContactSlot}
            {selectedContactMark ? ' + mark' : ''}
          </button>
        </div>
        <p className={styles.contactHint}>
          Pick any number. A saved point pauses and returns the car to its time,
          position, and contact type so you can update it.
        </p>
      </section>

      <div className={styles.progressBlock}>
        <div className={styles.labelRow}>
          <span>Lap progress</span>
          <strong>{progressPercent}%</strong>
        </div>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label="Driving Line Lab lap progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className={styles.ends}>
          <span>{formatTime(playheadSeconds)}</span>
          <span>{formatTime(durationSeconds)}</span>
        </div>
      </div>

      <div className={styles.positionBlock}>
        <div className={styles.labelRow}>
          <span>Car position</span>
          <strong>{formattedOffset}</strong>
        </div>
        <div className={styles.positionTrack} aria-hidden="true">
          <span style={{ left: `${viewerRoadPercent}%` }} />
        </div>
        <div className={styles.ends}>
          <span>Left</span>
          <span>Right</span>
        </div>
        {boundaryLimited ? (
          <p className={styles.boundary}>Two-wheel white-line limit reached</p>
        ) : null}
      </div>

      <div className={styles.driveControls} aria-label="Manual drive controls">
        <button
          type="button"
          onPointerDown={(event) => capturePointer(event, onForwardStart)}
          onPointerUp={onForwardEnd}
          onPointerCancel={onForwardEnd}
          onLostPointerCapture={onForwardEnd}
          disabled={!ready}
        >
          W / ↑ Forward
        </button>
        <button type="button" onClick={onStepBackward} disabled={!ready}>
          S / ↓ Back
        </button>
        <button
          type="button"
          onPointerDown={(event) =>
            capturePointer(event, () => onLateralStart(-1))
          }
          onPointerUp={onLateralEnd}
          onPointerCancel={onLateralEnd}
          onLostPointerCapture={onLateralEnd}
          disabled={!ready}
        >
          A / ← Left
        </button>
        <button
          type="button"
          onPointerDown={(event) =>
            capturePointer(event, () => onLateralStart(1))
          }
          onPointerUp={onLateralEnd}
          onPointerCancel={onLateralEnd}
          onLostPointerCapture={onLateralEnd}
          disabled={!ready}
        >
          D / → Right
        </button>
      </div>

      <p className={styles.controlHint}>
        Hold forward at the selected playback speed. Release to pause. Space
        toggles continuous play; Cmd/Ctrl+Z undoes the last change.
      </p>

      <div className={styles.surfaceBlock}>
        <div className={styles.labelRow}>
          <span>Contact type</span>
          <strong>{surfaceLabel(surface)}</strong>
        </div>
        <div className={styles.segmented}>
          <button
            type="button"
            aria-pressed={surface === 'white-line'}
            onClick={() => onSurfaceChange('white-line')}
          >
            White line
          </button>
          <button
            type="button"
            aria-pressed={surface === 'curb'}
            onClick={() => onSurfaceChange('curb')}
          >
            Curb
          </button>
          <button
            type="button"
            aria-pressed={surface === 'ref-point'}
            onClick={() => onSurfaceChange('ref-point')}
          >
            Ref point
          </button>
        </div>
      </div>

      <button
        type="button"
        className={styles.primary}
        onClick={onMark}
        disabled={!ready || playing}
      >
        {playing
          ? `Pause to ${selectedContactMark ? 'update' : 'mark'} contact ${selectedContactSlot}`
          : `${selectedContactMark ? 'Update' : 'Mark'} contact ${selectedContactSlot} · Enter`}
      </button>

      <button
        type="button"
        className={styles.quiet}
        onClick={onUndo}
        disabled={!canUndo}
      >
        Undo last change
      </button>

      <div className={styles.viewBlock}>
        <div className={styles.labelRow}>
          <span>3D view</span>
          <strong>{cameraView === 'overhead' ? 'Positioning' : 'Onboard'}</strong>
        </div>
        <button
          type="button"
          className={styles.quiet}
          onClick={() =>
            onCameraViewChange(cameraView === 'overhead' ? 'onboard' : 'overhead')
          }
        >
          {cameraView === 'overhead'
            ? 'Compare 3D onboard'
            : 'Back to positioning view'}
        </button>
        <div className={`${styles.labelRow} ${styles.cameraDistanceLabel}`}>
          <span>Aerial camera distance</span>
          <strong>{Math.round(cameraHeightMeters)} m</strong>
        </div>
        <input
          type="range"
          min={CALIBRATION_CAMERA_DISTANCE_CONTROL_MIN}
          max={CALIBRATION_CAMERA_DISTANCE_CONTROL_MAX}
          step={1}
          value={cameraDistanceControl}
          aria-label="Driving Line Lab camera distance"
          aria-valuetext={`${Math.round(cameraHeightMeters)} metres from the car`}
          disabled={cameraView === 'onboard'}
          onChange={(event) =>
            onCameraHeightChange(
              calibrationCameraHeightFromDistanceControl(
                Number(event.currentTarget.value),
              ),
            )
          }
        />
        <div className={styles.ends} aria-hidden="true">
          <span>Closer</span>
          <span>Farther</span>
        </div>
        <p className={styles.controlHint} aria-live="polite">
          {cameraView === 'onboard'
            ? `3D is ${Math.abs(comparisonOffsetSeconds).toFixed(2)} seconds ${comparisonOffsetSeconds >= 0 ? 'ahead of' : 'behind'} the footage.`
            : `Positioning preview: footage is ${videoLeadSeconds.toFixed(2)} seconds ahead of the 3D car.`}
        </p>
        <div className={`${styles.labelRow} ${styles.timingLabel}`}>
          <span>3D comparison timing</span>
          <strong>
            {comparisonOffsetSeconds >= 0 ? '+' : ''}
            {comparisonOffsetSeconds.toFixed(2)} s
          </strong>
        </div>
        <input
          type="range"
          min={DRIVING_LINE_COMPARISON_OFFSET_MIN_SECONDS}
          max={DRIVING_LINE_COMPARISON_OFFSET_MAX_SECONDS}
          step={DRIVING_LINE_COMPARISON_OFFSET_STEP_SECONDS}
          value={comparisonOffsetSeconds}
          aria-label="3D comparison timing offset"
          aria-valuetext={`3D ${Math.abs(comparisonOffsetSeconds).toFixed(2)} seconds ${comparisonOffsetSeconds >= 0 ? 'ahead of' : 'behind'} footage`}
          onChange={(event) =>
            onComparisonOffsetChange(Number(event.currentTarget.value))
          }
        />
        <div className={styles.ends} aria-hidden="true">
          <span>0.50 s behind</span>
          <span>0.50 s ahead</span>
        </div>
        <div className={styles.timingActions}>
          <button
            type="button"
            onClick={() =>
              onComparisonOffsetChange(
                comparisonOffsetSeconds -
                  DRIVING_LINE_COMPARISON_OFFSET_STEP_SECONDS,
              )
            }
            disabled={
              comparisonOffsetSeconds <=
              DRIVING_LINE_COMPARISON_OFFSET_MIN_SECONDS
            }
          >
            3D −0.01 s
          </button>
          <button
            type="button"
            onClick={() =>
              onComparisonOffsetChange(
                comparisonOffsetSeconds +
                  DRIVING_LINE_COMPARISON_OFFSET_STEP_SECONDS,
              )
            }
            disabled={
              comparisonOffsetSeconds >=
              DRIVING_LINE_COMPARISON_OFFSET_MAX_SECONDS
            }
          >
            3D +0.01 s
          </button>
        </div>
        <button
          type="button"
          className={styles.timingReset}
          onClick={() =>
            onComparisonOffsetChange(
              DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS,
            )
          }
          disabled={
            Math.abs(
              comparisonOffsetSeconds -
                DRIVING_LINE_COMPARISON_OFFSET_DEFAULT_SECONDS,
            ) < 1e-9
          }
        >
          Reset to +0.10 s
        </button>
        <p className={styles.controlHint}>
          Applies only to Compare 3D onboard. Pause on a landmark and adjust
          until both feeds reach it together.
        </p>
      </div>

      <div className={styles.exportActions}>
        <button
          type="button"
          className={styles.save}
          onClick={onSaveWorkspace}
          disabled={saveState.status === 'saving'}
        >
          {saveState.status === 'saving' ? 'Saving…' : 'Save pass to workspace'}
        </button>
        <button type="button" className={styles.quiet} onClick={onDownload}>
          Download JSON
        </button>
      </div>

      <p className={styles.saveStatus} aria-live="polite">
        {saveState.status === 'saved'
          ? `Saved ${saveState.path}`
          : saveState.status === 'error'
            ? saveState.message
            : 'Autosaved in this browser.'}
      </p>
    </aside>
  )
}

export type { SaveState as DrivingLineLabSaveState }
