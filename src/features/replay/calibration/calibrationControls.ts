/**
 * The track asset's lateral route axis is mirrored from the viewer's
 * left/right orientation. These helpers keep that conversion at the UI edge;
 * persisted takes continue to use the route coordinate everywhere else.
 */
export function viewerDirectionToRouteDirection(
  direction: -1 | 0 | 1,
): -1 | 0 | 1 {
  if (direction === 0) return 0
  return direction === -1 ? 1 : -1
}

export function viewerDeltaToRouteDelta(deltaMeters: number) {
  return -deltaMeters
}

export function viewerRoadFraction(roadFraction: number) {
  return 1 - Math.min(1, Math.max(0, roadFraction))
}
