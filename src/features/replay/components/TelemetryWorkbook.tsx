import { useMemo } from 'react'
import { GOLDEN_LAP_FACTS } from '../goldenLapFacts'
import type { ReplayFile } from '../replay'
import {
  drsPresentation,
  formatLapTime,
  telemetryAt,
  telemetryRanges,
  timingSectorAt,
} from '../telemetryWorkbook'
import styles from './TelemetryWorkbook.module.css'

type TelemetryWorkbookProps = {
  replay: ReplayFile | null
  playheadSeconds: number
}

const EMPTY_CAR_DATA: ReplayFile['car_data'] = []
const SECTOR_REFERENCE = GOLDEN_LAP_FACTS.sectorDurationsSeconds
  .map((duration) => duration.toFixed(3))
  .join(' / ')
const TYRE_AGE_AT_LAP_START =
  GOLDEN_LAP_FACTS.tyre.ageAtStintStartLaps +
  (GOLDEN_LAP_FACTS.lapNumber - GOLDEN_LAP_FACTS.tyre.lapStart)

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatInteger(value: number | null) {
  return value === null ? '--' : Math.round(value).toLocaleString('en-US')
}

function formatRange(range: { minimum: number; maximum: number } | undefined) {
  if (!range) return '—'
  return `${formatInteger(range.minimum)} — ${formatInteger(range.maximum)}`
}

export function TelemetryWorkbook({
  replay,
  playheadSeconds,
}: TelemetryWorkbookProps) {
  const carData = replay?.car_data ?? EMPTY_CAR_DATA
  const sample = useMemo(
    () => telemetryAt(carData, playheadSeconds),
    [carData, playheadSeconds],
  )
  const ranges = useMemo(() => telemetryRanges(carData), [carData])

  const speed = sample?.speed ?? null
  const throttle =
    sample === null ? null : Math.round(clamp(sample.throttle, 0, 100))
  const braking = sample === null ? null : sample.brake >= 50
  const gear =
    sample === null ? '--' : sample.n_gear === 0 ? 'N' : sample.n_gear
  const rpm = sample?.rpm ?? null
  const drs = drsPresentation(sample?.drs ?? null)
  const timingSector = timingSectorAt(
    playheadSeconds,
    GOLDEN_LAP_FACTS.sectorDurationsSeconds,
    replay?.lap.lap_duration ?? GOLDEN_LAP_FACTS.lapDurationSeconds,
  )
  const driverAcronym =
    replay?.driver.name_acronym ?? GOLDEN_LAP_FACTS.driverAcronym
  const driverNumber =
    replay?.driver.driver_number ?? GOLDEN_LAP_FACTS.driverNumber
  const lapNumber = replay?.lap.lap_number ?? GOLDEN_LAP_FACTS.lapNumber

  return (
    <section
      id="replay-workbook"
      className={styles.telemetry}
      aria-label="Onboard data"
    >
      <div className={styles.tableViewport}>
        <table className={styles.sheet}>
          <caption className={styles.srOnly}>
            Live car telemetry and official context for{' '}
            {GOLDEN_LAP_FACTS.driverName}'s 2024 Montréal qualifying pole lap
          </caption>
          <colgroup>
            <col className={styles.channelColumn} />
            <col className={styles.valueColumn} />
            <col className={styles.referenceColumn} />
            <col className={styles.unitColumn} />
          </colgroup>
          <thead>
            <tr className={styles.fieldHeaders}>
              <th scope="col">Channel</th>
              <th scope="col">Value</th>
              <th scope="col">Lap reference</th>
              <th scope="col">Unit / state</th>
            </tr>
          </thead>
          <tbody>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Speed
                </th>
                <td className={styles.valueCell}>
                  <span>{formatInteger(speed)}</span>
                </td>
                <td>{formatRange(ranges?.speed)}</td>
                <td>km/h</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Throttle
                </th>
                <td className={styles.valueCell}>
                  <span>{formatInteger(throttle)}</span>
                </td>
                <td>{formatRange(ranges?.throttle)}</td>
                <td>%</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Brake
                </th>
                <td
                  className={`${styles.valueCell} ${braking ? styles.brakeOn : ''}`}
                >
                  {braking === null ? '--' : braking ? 'ON' : 'OFF'}
                </td>
                <td>Binary channel</td>
                <td>0 / 100</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Gear
                </th>
                <td className={styles.valueCell}>{gear}</td>
                <td>{formatRange(ranges?.gear)}</td>
                <td>ratio</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Engine
                </th>
                <td className={styles.valueCell}>{formatInteger(rpm)}</td>
                <td>{formatRange(ranges?.rpm)}</td>
                <td>rpm</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  DRS
                </th>
                <td
                  className={`${styles.valueCell} ${styles.drsCell}`}
                  data-state={drs.state}
                >
                  {drs.label}
                </td>
                <td>{sample ? `Code ${sample.drs}` : 'Codes 8 / 12 / 14'}</td>
                <td>state</td>
              </tr>
              <tr className={styles.sectionRow}>
                <th colSpan={3} scope="row">
                  {driverAcronym} #{driverNumber} · {GOLDEN_LAP_FACTS.teamName}{' '}
                  · {GOLDEN_LAP_FACTS.sessionPhase} · Lap {lapNumber} ·{' '}
                  {GOLDEN_LAP_FACTS.result}
                </th>
                <td>{GOLDEN_LAP_FACTS.source}</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Lap clock
                </th>
                <td className={styles.valueCell}>
                  {formatLapTime(playheadSeconds)}
                </td>
                <td>{formatLapTime(GOLDEN_LAP_FACTS.lapDurationSeconds)}</td>
                <td>elapsed</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Sector
                </th>
                <td className={styles.valueCell}>{timingSector}</td>
                <td title="Sector 1 / Sector 2 / Sector 3">
                  {SECTOR_REFERENCE}
                </td>
                <td>seconds</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Speed gates
                </th>
                <td>I1 {GOLDEN_LAP_FACTS.speedGatesKph.intermediate1}</td>
                <td>
                  I2 {GOLDEN_LAP_FACTS.speedGatesKph.intermediate2} · ST{' '}
                  {GOLDEN_LAP_FACTS.speedGatesKph.trap}
                </td>
                <td>km/h</td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Tyre
                </th>
                <td className={styles.valueCell}>
                  {GOLDEN_LAP_FACTS.tyre.compound}
                </td>
                <td
                  title={`${GOLDEN_LAP_FACTS.tyre.ageAtStintStartLaps} laps old at the start of stint ${GOLDEN_LAP_FACTS.tyre.stintNumber}; ${TYRE_AGE_AT_LAP_START} laps old at the start of lap ${lapNumber}`}
                >
                  Stint {GOLDEN_LAP_FACTS.tyre.stintNumber} ·{' '}
                  {TYRE_AGE_AT_LAP_START} laps old
                </td>
                <td>
                  L{GOLDEN_LAP_FACTS.tyre.lapStart}–
                  {GOLDEN_LAP_FACTS.tyre.lapEnd}
                </td>
              </tr>
              <tr>
                <th className={styles.channelCell} scope="row">
                  Conditions
                </th>
                <td title={`Weather sample ${GOLDEN_LAP_FACTS.weather.sampleDate}`}>
                  {GOLDEN_LAP_FACTS.weather.airTemperatureCelsius}° air
                </td>
                <td>
                  {GOLDEN_LAP_FACTS.weather.trackTemperatureCelsius}° track ·{' '}
                  {GOLDEN_LAP_FACTS.weather.humidityPercent}% RH
                </td>
                <td>
                  {GOLDEN_LAP_FACTS.weather.rainfall === 0 ? 'Dry' : 'Rain'}
                </td>
              </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
