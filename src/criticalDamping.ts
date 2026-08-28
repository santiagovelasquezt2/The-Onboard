/**
 * Exact critical-damping step for a target held constant over one frame.
 * Unlike an Euler spring, this remains stable when the renderer has a slow
 * frame (for example while Chrome decodes a video frame).
 */
export function criticallyDampedStep(
  current: number,
  target: number,
  velocity: number,
  deltaSeconds: number,
  responseSeconds: number,
): { value: number; velocity: number } {
  if (
    responseSeconds <= 0 ||
    deltaSeconds <= 0 ||
    !Number.isFinite(deltaSeconds)
  ) {
    return { value: target, velocity: 0 }
  }

  const omega = 2 / responseSeconds
  const displacement = current - target
  const decay = Math.exp(-omega * deltaSeconds)
  const velocityTerm = velocity + omega * displacement
  return {
    value: target + (displacement + velocityTerm * deltaSeconds) * decay,
    velocity: (velocity - omega * velocityTerm * deltaSeconds) * decay,
  }
}
