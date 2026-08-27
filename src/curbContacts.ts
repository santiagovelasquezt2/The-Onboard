export type CurbSide = 'left' | 'right'

export type AuditedCurbContact = {
  /** Shared-clock time, where 0 is the official start of lap 22. */
  startLapTimeSeconds: number
  endLapTimeSeconds: number
  side: CurbSide
  label: string
  /** 0 = white-line kiss, 1 = full wheel-on-kerb geometry target. */
  blend?: number
  /** Signed nudge along tire-side; positive = toward curb/outward on that side. */
  lateralNudgeMeters?: number
  /** Override REPLAY_WHITE_LINE_TIRE_INSET_METERS for this contact. */
  whiteLineInsetMeters?: number
}

/**
 * High-confidence tire-on-curb windows audited frame-by-frame from Russell's
 * local 50 fps onboard. Approaches where the curb is merely visible, and
 * moments where the tire is already beyond it on runoff, are intentionally
 * excluded. These are visual lateral targets; OpenF1 remains the timing and
 * longitudinal-progress source.
 */
export const AUDITED_CURB_CONTACTS: readonly AuditedCurbContact[] = [
  {
    startLapTimeSeconds: 3.4,
    endLapTimeSeconds: 3.9,
    side: 'left',
    label: 'Turn 1 apex',
    blend: 0.82,
    lateralNudgeMeters: 0.06,
  },
  {
    startLapTimeSeconds: 5.4,
    endLapTimeSeconds: 5.9,
    side: 'right',
    label: 'Turn 2 apex',
    blend: 0.45,
  },
  {
    startLapTimeSeconds: 8.5,
    endLapTimeSeconds: 9.7,
    side: 'left',
    label: 'Turn 2 exit',
    blend: 0.42,
    lateralNudgeMeters: -0.06,
  },
  {
    startLapTimeSeconds: 13.8,
    endLapTimeSeconds: 14.3,
    side: 'right',
    label: 'Turn 3 apex',
    blend: 0.78,
    lateralNudgeMeters: 0.12,
  },
  {
    startLapTimeSeconds: 15.2,
    endLapTimeSeconds: 15.5,
    side: 'left',
    label: 'Turn 4 apex',
    blend: 0.72,
  },
  {
    startLapTimeSeconds: 17.8,
    endLapTimeSeconds: 18,
    side: 'left',
    label: 'Turn 5 exit',
    blend: 0.72,
  },
  {
    startLapTimeSeconds: 23.1,
    endLapTimeSeconds: 24.1,
    side: 'left',
    label: 'Turn 6 apex',
    blend: 0.72,
  },
  {
    startLapTimeSeconds: 24.9,
    endLapTimeSeconds: 25.6,
    side: 'right',
    label: 'Turn 7 apex',
    blend: 0.55,
    lateralNudgeMeters: -0.08,
  },
  {
    startLapTimeSeconds: 26.9,
    endLapTimeSeconds: 27.6,
    side: 'left',
    label: 'Turn 7 exit',
    blend: 0.65,
  },
  {
    startLapTimeSeconds: 35.3,
    endLapTimeSeconds: 35.7,
    side: 'right',
    label: 'Turn 8 apex',
    blend: 0.62,
  },
  {
    startLapTimeSeconds: 36,
    endLapTimeSeconds: 36.7,
    side: 'left',
    label: 'Turn 9 apex',
    blend: 0.92,
    lateralNudgeMeters: 0.35,
  },
  {
    startLapTimeSeconds: 37.6,
    endLapTimeSeconds: 38.6,
    side: 'right',
    label: 'Turn 9 exit',
    blend: 0.68,
  },
  {
    startLapTimeSeconds: 50,
    endLapTimeSeconds: 51.1,
    side: 'left',
    label: 'Turn 10 exit',
    blend: 0.58,
    lateralNudgeMeters: -0.05,
  },
  {
    startLapTimeSeconds: 64.6,
    endLapTimeSeconds: 65,
    side: 'right',
    label: 'Turn 13 apex',
    blend: 0.55,
    lateralNudgeMeters: 0.1,
  },
  {
    startLapTimeSeconds: 65.3,
    endLapTimeSeconds: 65.8,
    side: 'left',
    label: 'Turn 14 apex',
    blend: 0.78,
    lateralNudgeMeters: 0.25,
  },
  {
    startLapTimeSeconds: 66.55,
    endLapTimeSeconds: 67.2,
    side: 'right',
    label: 'Turn 14 exit',
    blend: 0.48,
    lateralNudgeMeters: -0.08,
  },
]

export function adjacentCurbContact(
  playheadSeconds: number,
  direction: -1 | 1,
) {
  if (direction > 0) {
    return (
      AUDITED_CURB_CONTACTS.find(
        (contact) => contact.startLapTimeSeconds > playheadSeconds + 0.01,
      ) ?? AUDITED_CURB_CONTACTS[0]
    )
  }

  return (
    [...AUDITED_CURB_CONTACTS]
      .reverse()
      .find(
        (contact) => contact.endLapTimeSeconds < playheadSeconds - 0.01,
      ) ?? AUDITED_CURB_CONTACTS[AUDITED_CURB_CONTACTS.length - 1]
  )
}
