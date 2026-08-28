import type { RacingLineAnchor } from './racingLineCalibration'

export const DEFAULT_REPLAY_DURATION_SECONDS = 72

export const DEFAULT_RACING_LINE_ANCHORS: readonly RacingLineAnchor[] = [
  { lapTimeSeconds: 2.0, deltaMeters: -1.6 },
  { lapTimeSeconds: 7.5, deltaMeters: -2.6 },
  { lapTimeSeconds: 11.5, deltaMeters: -3.4 },
  { lapTimeSeconds: 16.5, deltaMeters: -0.55 },
  { lapTimeSeconds: 19.5, deltaMeters: -1.6 },
  { lapTimeSeconds: 20.2, deltaMeters: -1.9 },
  { lapTimeSeconds: 21.5, deltaMeters: -2.0 },
  { lapTimeSeconds: 28.5, deltaMeters: -2.6 },
  { lapTimeSeconds: 32.0, deltaMeters: -1.4 },
  { lapTimeSeconds: 40.0, deltaMeters: -2.3 },
  { lapTimeSeconds: 42.0, deltaMeters: -4.0 },
  { lapTimeSeconds: 46.0, deltaMeters: -2.6 },
  { lapTimeSeconds: 48.0, deltaMeters: -3.6 },
  { lapTimeSeconds: 52.5, deltaMeters: -2.0 },
  { lapTimeSeconds: 55.0, deltaMeters: -3.3 },
  { lapTimeSeconds: 57.0, deltaMeters: -2.8 },
  { lapTimeSeconds: 58.5, deltaMeters: -2.6 },
  { lapTimeSeconds: 59.5, deltaMeters: -3.2 },
  { lapTimeSeconds: 60.5, deltaMeters: -3.6 },
  { lapTimeSeconds: 61.5, deltaMeters: -3.8 },
  { lapTimeSeconds: 62.2, deltaMeters: -3.6 },
  { lapTimeSeconds: 63.0, deltaMeters: -1.2 },
  { lapTimeSeconds: 63.6, deltaMeters: -0.2 },
  { lapTimeSeconds: 68.5, deltaMeters: -1.8 },
  { lapTimeSeconds: 69.5, deltaMeters: -2.2 },
  { lapTimeSeconds: 70.5, deltaMeters: -2.4 },
]
