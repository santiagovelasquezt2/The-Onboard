import type * as THREE from 'three'
import { SHADOW_MAP_SIZE } from './sceneConfig.ts'

export type ReplayRenderQuality = 'high' | 'reduced'

export type ReplayQualitySettings = {
  dpr: [minimum: number, maximum: number]
  shadowMapSize: number
}

export const REPLAY_QUALITY_SETTINGS: Record<
  ReplayRenderQuality,
  ReplayQualitySettings
> = {
  high: {
    dpr: [1, 1.5],
    shadowMapSize: SHADOW_MAP_SIZE,
  },
  reduced: {
    dpr: [1, 1.25],
    shadowMapSize: 1024,
  },
}

/** Ignore shader warm-up and require two complete slow windows before reducing. */
export const REPLAY_QUALITY_WARMUP_SECONDS = 2
export const REPLAY_QUALITY_WINDOW_SECONDS = 1.5
export const REPLAY_QUALITY_MINIMUM_FPS = 52
export const REPLAY_QUALITY_SLOW_WINDOWS = 2
export const REPLAY_QUALITY_MAX_FRAME_DELTA_SECONDS = 0.25

export type ReplayQualitySampler = {
  warmupSeconds: number
  windowSeconds: number
  windowFrames: number
  consecutiveSlowWindows: number
}

export type ReplayQualityObservation = {
  fps: number
  shouldReduce: boolean
}

export function createReplayQualitySampler(): ReplayQualitySampler {
  return {
    warmupSeconds: 0,
    windowSeconds: 0,
    windowFrames: 0,
    consecutiveSlowWindows: 0,
  }
}

export function resetReplayQualitySampler(sampler: ReplayQualitySampler) {
  sampler.warmupSeconds = 0
  sampler.windowSeconds = 0
  sampler.windowFrames = 0
  sampler.consecutiveSlowWindows = 0
}

/**
 * Mutates one tiny sampler object and allocates only when a full window closes.
 * The reduced tier is intentionally sticky for the page session: repeatedly
 * changing render resolution is more noticeable than retaining DPR 1.25.
 */
export function observeReplayQualityFrame(
  sampler: ReplayQualitySampler,
  deltaSeconds: number,
): ReplayQualityObservation | null {
  if (
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0 ||
    deltaSeconds > REPLAY_QUALITY_MAX_FRAME_DELTA_SECONDS
  ) {
    return null
  }

  if (sampler.warmupSeconds < REPLAY_QUALITY_WARMUP_SECONDS) {
    sampler.warmupSeconds += deltaSeconds
    return null
  }

  sampler.windowSeconds += deltaSeconds
  sampler.windowFrames += 1
  if (sampler.windowSeconds < REPLAY_QUALITY_WINDOW_SECONDS) return null

  const fps = sampler.windowFrames / sampler.windowSeconds
  sampler.windowSeconds = 0
  sampler.windowFrames = 0
  sampler.consecutiveSlowWindows =
    fps < REPLAY_QUALITY_MINIMUM_FPS
      ? sampler.consecutiveSlowWindows + 1
      : 0

  return {
    fps,
    shouldReduce:
      sampler.consecutiveSlowWindows >= REPLAY_QUALITY_SLOW_WINDOWS,
  }
}

/** `?scene-quality=high|low` is a deterministic QA escape hatch. */
export function resolveReplayQualityOverride(
  search: string,
): ReplayRenderQuality | null {
  const value = new URLSearchParams(search).get('scene-quality')
  if (value === 'high') return 'high'
  if (value === 'low' || value === 'reduced') return 'reduced'
  return null
}

/**
 * Three does not recreate an existing shadow render target when mapSize alone
 * changes. Dispose it explicitly so the next shadow pass allocates the selected
 * quality tier instead of rendering into the stale target.
 */
export function resizeDirectionalShadowMap(
  shadow: THREE.DirectionalLightShadow,
  size: number,
): boolean {
  const nextSize = Math.max(1, Math.floor(size))
  const mapHasWrongSize = Boolean(
    shadow.map &&
      (shadow.map.width !== nextSize || shadow.map.height !== nextSize),
  )
  const sizeChanged =
    shadow.mapSize.x !== nextSize || shadow.mapSize.y !== nextSize
  if (!sizeChanged && !mapHasWrongSize) return false

  shadow.mapSize.set(nextSize, nextSize)
  shadow.map?.dispose()
  shadow.map = null
  shadow.mapPass?.dispose()
  shadow.mapPass = null
  shadow.needsUpdate = true
  return true
}
