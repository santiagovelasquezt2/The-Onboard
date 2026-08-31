import { useMemo, type CSSProperties } from 'react'
import {
  createPhysicsWorkbook,
  physicsAt,
  type PhysicsWorkbook as PhysicsWorkbookModel,
} from '../physicsWorkbook'
import type { ReplayFile } from '../replay'
import styles from './PhysicsWorkbook.module.css'

type PhysicsWorkbookProps = {
  replay: ReplayFile | null
  playheadSeconds: number
}

type ForceStyle = CSSProperties & {
  '--force-x': string
  '--force-y': string
}

const WORKBOOK_CACHE = new WeakMap<ReplayFile, PhysicsWorkbookModel>()
const FORCE_SCALE_G = 4.5

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function physicsWorkbookFor(replay: ReplayFile) {
  const cached = WORKBOOK_CACHE.get(replay)
  if (cached) return cached
  const workbook = createPhysicsWorkbook(replay)
  WORKBOOK_CACHE.set(replay, workbook)
  return workbook
}

function formatG(value: number | null) {
  return value === null ? '--' : value.toFixed(1)
}

function formatInteger(value: number | null) {
  return value === null ? '--' : Math.round(value).toLocaleString('en-US')
}

function loadLabel(value: number | null) {
  if (value === null) return 'NO READING'
  if (value < 0.5) return 'LIGHT'
  if (value < 1.5) return 'MEDIUM'
  if (value < 2.75) return 'HEAVY'
  return 'EXTREME'
}

export function PhysicsWorkbook({
  replay,
  playheadSeconds,
}: PhysicsWorkbookProps) {
  const workbook = useMemo(
    () => (replay ? physicsWorkbookFor(replay) : null),
    [replay],
  )
  const reading = useMemo(
    () => (workbook ? physicsAt(workbook, playheadSeconds) : null),
    [playheadSeconds, workbook],
  )
  const activeReading = reading?.status === 'active' ? reading : null
  const forceG = activeReading?.combinedG ?? null
  const forceReady = forceG !== null
  const forceX = forceReady
    ? clamp(-(activeReading?.lateralG ?? 0) / FORCE_SCALE_G, -1, 1) * 34
    : 0
  const forceY = forceReady
    ? clamp((activeReading?.longitudinalG ?? 0) / FORCE_SCALE_G, -1, 1) * 34
    : 0
  const forceStyle: ForceStyle = {
    '--force-x': `${forceX}%`,
    '--force-y': `${forceY}%`,
  }
  return (
    <section
      id="replay-workbook"
      className={styles.physics}
      aria-label="Vehicle physics"
    >
      <div className={styles.panel}>
        <div
          className={styles.speedReadout}
          aria-label={
            activeReading
              ? `${formatInteger(activeReading.speedKph)} kilometers per hour`
              : 'Speed unavailable'
          }
        >
          <strong>{formatInteger(activeReading?.speedKph ?? null)}</strong>
          <span>km/h</span>
        </div>
        <div className={styles.forceBlock}>
          <div
            className={styles.forceMap}
            role="img"
            aria-label={
              forceReady
                ? `${formatG(forceG)} G vehicle load`
                : 'Vehicle load unavailable'
            }
          >
            <span className={styles.brakeLabel}>Brake</span>
            <span className={styles.goLabel}>Go</span>
            <span className={styles.leftLabel}>Left</span>
            <span className={styles.rightLabel}>Right</span>
            <span className={styles.horizontalAxis} aria-hidden="true" />
            <span className={styles.verticalAxis} aria-hidden="true" />
            <span
              className={styles.forceDot}
              data-ready={forceReady}
              style={forceStyle}
              aria-hidden="true"
            />
          </div>

          <div className={styles.forceReadout}>
            <div>
              <strong>{formatG(forceG)}</strong>
              <span>G</span>
            </div>
            <p>{loadLabel(forceG)}</p>
          </div>
        </div>
        <p className={styles.srOnly}>
          Estimated vehicle motion, not individual tyre force.
        </p>
      </div>
    </section>
  )
}
