/**
 * Practical recording chunks for Russell's 72-second 2024 Montreal pole lap.
 *
 * These are deliberately not the official three timing sectors.  Their cuts
 * sit on the short, settled bits between corner complexes so an authored run
 * never has to stop at an apex.  The timing is anchored to the audited onboard
 * landmarks in `curbContacts.ts` (for example T1/T2: 3.4–9.7 s, T6/T7:
 * 23.1–27.6 s, T8/T9: 35.3–38.6 s, and the final chicane: 64.6–67.2 s).
 */

export const CALIBRATION_SECTION_LAP_DURATION_SECONDS = 72

export type CalibrationSectionKind = 'straight' | 'corner-complex'

export type CalibrationSection = {
  /** Stable persistence key; do not derive this from the display label. */
  id: string
  /** Short label for the recorder UI. */
  label: string
  /** Compact label for the direct-access section grid. */
  shortLabel: string
  kind: CalibrationSectionKind
  /** Inclusive shared-playhead boundary. */
  startLapTimeSeconds: number
  /** Inclusive only for the final section; otherwise it starts the next one. */
  endLapTimeSeconds: number
}

/**
 * Ordered lap chunks used by the simple manual recorder.
 *
 * Each section ends after the preceding complex has settled or just before
 * braking starts for the following one.  That gives the next recording a
 * sensible inherited entry position without creating a seam in a corner.
 */
export const CALIBRATION_SECTIONS: readonly CalibrationSection[] = [
  {
    id: 'opening-chicane',
    label: 'Opening chicane · Turns 1–2',
    shortLabel: 'T1–2',
    kind: 'corner-complex',
    startLapTimeSeconds: 0,
    endLapTimeSeconds: 10,
  },
  {
    id: 'turns-3-to-5',
    label: 'Turns 3–5',
    shortLabel: 'T3–5',
    kind: 'corner-complex',
    startLapTimeSeconds: 10,
    endLapTimeSeconds: 19,
  },
  {
    id: 'turns-6-to-7',
    label: 'Turns 6–7',
    shortLabel: 'T6–7',
    kind: 'corner-complex',
    startLapTimeSeconds: 19,
    endLapTimeSeconds: 29,
  },
  {
    id: 'run-to-turns-8-9',
    label: 'Run to Turns 8–9',
    shortLabel: 'To T8–9',
    kind: 'straight',
    startLapTimeSeconds: 29,
    endLapTimeSeconds: 33,
  },
  {
    id: 'turns-8-to-9',
    label: 'Turns 8–9',
    shortLabel: 'T8–9',
    kind: 'corner-complex',
    startLapTimeSeconds: 33,
    endLapTimeSeconds: 40,
  },
  {
    id: 'hairpin',
    label: 'Hairpin · Turn 10',
    shortLabel: 'T10',
    kind: 'corner-complex',
    startLapTimeSeconds: 40,
    endLapTimeSeconds: 52,
  },
  {
    id: 'casino-straight',
    label: 'Casino straight',
    shortLabel: 'Casino',
    kind: 'straight',
    startLapTimeSeconds: 52,
    endLapTimeSeconds: 63,
  },
  {
    id: 'final-chicane',
    label: 'Final chicane · Turns 13–14',
    shortLabel: 'T13–14',
    kind: 'corner-complex',
    startLapTimeSeconds: 63,
    endLapTimeSeconds: 68,
  },
  {
    id: 'start-finish-straight',
    label: 'Start/finish straight',
    shortLabel: 'Finish',
    kind: 'straight',
    startLapTimeSeconds: 68,
    endLapTimeSeconds: CALIBRATION_SECTION_LAP_DURATION_SECONDS,
  },
]

export function calibrationSectionIndexById(id: string) {
  return CALIBRATION_SECTIONS.findIndex((section) => section.id === id)
}

export function calibrationSectionById(id: string) {
  return CALIBRATION_SECTIONS.find((section) => section.id === id) ?? null
}

/**
 * Resolves a shared-playhead time to a chunk.  At a shared boundary the next
 * chunk wins, except for the final 72.0-second endpoint, which belongs to the
 * final straight so the UI always has a valid current section.
 */
export function calibrationSectionAtLapTime(lapTimeSeconds: number) {
  if (!Number.isFinite(lapTimeSeconds)) return null

  return (
    CALIBRATION_SECTIONS.find(
      (section, index) =>
        lapTimeSeconds >= section.startLapTimeSeconds &&
        (lapTimeSeconds < section.endLapTimeSeconds ||
          (index === CALIBRATION_SECTIONS.length - 1 &&
            lapTimeSeconds <= section.endLapTimeSeconds)),
    ) ?? null
  )
}

export function clampLapTimeToCalibrationSection(
  lapTimeSeconds: number,
  section: CalibrationSection,
) {
  if (!Number.isFinite(lapTimeSeconds)) return section.startLapTimeSeconds

  return Math.min(
    section.endLapTimeSeconds,
    Math.max(section.startLapTimeSeconds, lapTimeSeconds),
  )
}

export function calibrationSectionProgress(
  lapTimeSeconds: number,
  section: CalibrationSection,
) {
  const duration = section.endLapTimeSeconds - section.startLapTimeSeconds
  if (duration <= 0) return 0

  return (
    (clampLapTimeToCalibrationSection(lapTimeSeconds, section) -
      section.startLapTimeSeconds) /
    duration
  )
}
