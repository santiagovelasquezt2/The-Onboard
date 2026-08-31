/**
 * Tracked, offline snapshot of the event-shaped OpenF1 records that sit beside
 * the replay's high-frequency sample streams. The v1 product is deliberately
 * locked to this one lap, so keeping these facts in source makes the UI
 * portable without adding runtime API calls.
 *
 * Verified against session 9527 on 2026-08-30: /laps, /stints, /weather, and
 * /session_result for George Russell (driver 63), lap 22.
 */
export const GOLDEN_LAP_FACTS = {
  source: 'OpenF1',
  sessionKey: 9527,
  driverNumber: 63,
  driverName: 'George Russell',
  driverAcronym: 'RUS',
  teamName: 'Mercedes',
  circuitName: 'Montréal',
  sessionPhase: 'Q3',
  result: 'P1 · Pole',
  lapNumber: 22,
  lapDurationSeconds: 72,
  sectorDurationsSeconds: [20.123, 22.726, 29.151],
  speedGatesKph: {
    intermediate1: 264,
    intermediate2: 284,
    trap: 330,
  },
  tyre: {
    compound: 'SOFT',
    stintNumber: 5,
    lapStart: 21,
    lapEnd: 24,
    ageAtStintStartLaps: 3,
  },
  weather: {
    sampleDate: '2024-06-08T20:52:07.109000+00:00',
    airTemperatureCelsius: 20.8,
    trackTemperatureCelsius: 30.2,
    humidityPercent: 64,
    rainfall: 0,
  },
} as const
