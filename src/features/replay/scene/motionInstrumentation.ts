import * as THREE from 'three'
import type { ReplayCorridorSample } from './replayMotion'

export type MotionFrameMetrics = {
  timestampMs: number
  positionDisplacementMeters: number
  headingDeltaDegrees: number
  lateralOffsetMeters: number | null
  lateralVelocityMetersPerSecond: number | null
  accelerationMetersPerSecondSquared: number
  jerkMetersPerSecondCubed: number
  clockDriftSeconds: number
  inCurbWindow: boolean
  curbLabel: string | null
}

export type MotionSummary = {
  frameCount: number
  elapsedSeconds: number
  maxPositionDisplacementMeters: number
  maxHeadingDeltaDegrees: number
  maxAccelerationMetersPerSecondSquared: number
  maxJerkMetersPerSecondCubed: number
  maxClockDriftSeconds: number
  maxLateralVelocityMetersPerSecond: number | null
  curbDiscontinuityCount: number
  worstFrames: MotionFrameMetrics[]
}

declare global {
  interface Window {
    __motionMetrics?: MotionInstrumenter
  }
}

export class MotionInstrumenter {
  private readonly frames: MotionFrameMetrics[] = []
  private previousPosition: THREE.Vector3 | null = null
  private previousHeading: THREE.Vector3 | null = null
  private previousLateralOffset: number | null = null
  private previousSpeed = 0
  private previousAcceleration = 0
  private previousTimestampMs: number | null = null
  private summaryStartMs = performance.now()
  private lastSummaryMs = performance.now()
  private curbDiscontinuityCount = 0
  private previousCurbLabel: string | null = null
  private previousInCurbWindow = false

  constructor() {
    if (import.meta.env.DEV) {
      window.__motionMetrics = this
    }
  }

  recordFrame(input: {
    position: THREE.Vector3
    heading: THREE.Vector3
    clockDriftSeconds: number
    corridorSample?: ReplayCorridorSample | null
  }): MotionFrameMetrics {
    const timestampMs = performance.now()
    const { position, heading, clockDriftSeconds, corridorSample } = input

    let positionDisplacementMeters = 0
    let headingDeltaDegrees = 0
    let accelerationMetersPerSecondSquared = 0
    let jerkMetersPerSecondCubed = 0
    let lateralVelocityMetersPerSecond: number | null = null

    const lateralOffsetMeters = corridorSample?.offsetMeters ?? null
    const inCurbWindow = Boolean(corridorSample?.curbWeight && corridorSample.curbWeight > 0)
    const curbLabel = corridorSample?.curbLabel ?? null

    if (this.previousPosition) {
      positionDisplacementMeters = position.distanceTo(this.previousPosition)
    }

    if (this.previousHeading) {
      const dot = THREE.MathUtils.clamp(
        this.previousHeading.dot(heading),
        -1,
        1,
      )
      headingDeltaDegrees = THREE.MathUtils.radToDeg(Math.acos(dot))
    }

    if (
      this.previousTimestampMs !== null &&
      this.previousPosition !== null
    ) {
      const deltaSeconds = (timestampMs - this.previousTimestampMs) / 1000
      if (deltaSeconds > 1e-6) {
        const speed = positionDisplacementMeters / deltaSeconds
        accelerationMetersPerSecondSquared =
          (speed - this.previousSpeed) / deltaSeconds
        jerkMetersPerSecondCubed =
          (accelerationMetersPerSecondSquared - this.previousAcceleration) /
          deltaSeconds
        this.previousAcceleration = accelerationMetersPerSecondSquared
        this.previousSpeed = speed

        if (
          lateralOffsetMeters !== null &&
          this.previousLateralOffset !== null
        ) {
          lateralVelocityMetersPerSecond =
            (lateralOffsetMeters - this.previousLateralOffset) / deltaSeconds
        }
      }
    }

    const enteredCurbWindow = inCurbWindow && !this.previousInCurbWindow
    const leftCurbWindow = !inCurbWindow && this.previousInCurbWindow
    if (
      (enteredCurbWindow || leftCurbWindow) &&
      positionDisplacementMeters > 0.08
    ) {
      this.curbDiscontinuityCount += 1
    }
    if (
      inCurbWindow &&
      this.previousCurbLabel &&
      curbLabel &&
      curbLabel !== this.previousCurbLabel &&
      positionDisplacementMeters > 0.08
    ) {
      this.curbDiscontinuityCount += 1
    }

    const metrics: MotionFrameMetrics = {
      timestampMs,
      positionDisplacementMeters,
      headingDeltaDegrees,
      lateralOffsetMeters,
      lateralVelocityMetersPerSecond,
      accelerationMetersPerSecondSquared,
      jerkMetersPerSecondCubed,
      clockDriftSeconds,
      inCurbWindow,
      curbLabel,
    }

    this.frames.push(metrics)
    if (this.frames.length > 7200) {
      this.frames.splice(0, this.frames.length - 7200)
    }

    this.previousPosition = position.clone()
    this.previousHeading = heading.clone()
    this.previousLateralOffset = lateralOffsetMeters
    this.previousTimestampMs = timestampMs
    this.previousInCurbWindow = inCurbWindow
    this.previousCurbLabel = curbLabel

    if (timestampMs - this.lastSummaryMs >= 5000) {
      this.logSummary()
      this.lastSummaryMs = timestampMs
    }

    return metrics
  }

  logSummary(): MotionSummary {
    const elapsedSeconds = (performance.now() - this.summaryStartMs) / 1000
    const recent = this.frames.slice(-300)
    const summary: MotionSummary = {
      frameCount: recent.length,
      elapsedSeconds,
      maxPositionDisplacementMeters: 0,
      maxHeadingDeltaDegrees: 0,
      maxAccelerationMetersPerSecondSquared: 0,
      maxJerkMetersPerSecondCubed: 0,
      maxClockDriftSeconds: 0,
      maxLateralVelocityMetersPerSecond: null,
      curbDiscontinuityCount: this.curbDiscontinuityCount,
      worstFrames: [],
    }

    for (const frame of recent) {
      summary.maxPositionDisplacementMeters = Math.max(
        summary.maxPositionDisplacementMeters,
        frame.positionDisplacementMeters,
      )
      summary.maxHeadingDeltaDegrees = Math.max(
        summary.maxHeadingDeltaDegrees,
        frame.headingDeltaDegrees,
      )
      summary.maxAccelerationMetersPerSecondSquared = Math.max(
        summary.maxAccelerationMetersPerSecondSquared,
        Math.abs(frame.accelerationMetersPerSecondSquared),
      )
      summary.maxJerkMetersPerSecondCubed = Math.max(
        summary.maxJerkMetersPerSecondCubed,
        Math.abs(frame.jerkMetersPerSecondCubed),
      )
      summary.maxClockDriftSeconds = Math.max(
        summary.maxClockDriftSeconds,
        Math.abs(frame.clockDriftSeconds),
      )
      if (frame.lateralVelocityMetersPerSecond !== null) {
        summary.maxLateralVelocityMetersPerSecond = Math.max(
          summary.maxLateralVelocityMetersPerSecond ?? 0,
          Math.abs(frame.lateralVelocityMetersPerSecond),
        )
      }
    }

    summary.worstFrames = [...recent]
      .sort(
        (a, b) =>
          b.positionDisplacementMeters - a.positionDisplacementMeters,
      )
      .slice(0, 5)

    if (import.meta.env.DEV) {
      console.debug('[motion]', summary)
    }

    return summary
  }

  getFrames(): readonly MotionFrameMetrics[] {
    return this.frames
  }
}
