/**
 * Single tuning surface for the 3D scene.
 *
 * Both GLBs are authored in metres and render at native scale (no fitting), so
 * every distance below is a real-world metre. Montreal spans ~5.7 x 7.2 km and
 * the W14 is 2.01 x 1.19 x 5.63 m — that 3000:1 range is why the renderer needs
 * a logarithmic depth buffer and why the sun's shadow frustum has to be pinned
 * to the car instead of the scene.
 */

import { RUNTIME_ASSETS } from '../../../runtimeAssets.ts'

/** Optimized runtime GLBs (gitignored); source assets stay untouched for rebuilds. */
export const TRACK_URL = RUNTIME_ASSETS.trackModelUrl
export const CAR_URL = RUNTIME_ASSETS.carModelUrl

// ---------------------------------------------------------------- track model

/** Track meshes considered driveable when searching for a spawn surface. */
export const ASPHALT_MATERIAL_PATTERN = /asphalt/i

/** Main racing surface only; Asphalt02 is a nearby paddock/access road. */
export const REPLAY_ROAD_MATERIAL_PATTERN = /^(AsphaltMat|Asphalt03Mat)$/i

/** The lap may use the modeled kerbs, but never paddock/access asphalt. */
export const REPLAY_DRIVEABLE_MATERIAL_PATTERN =
  /^(AsphaltMat|Asphalt03Mat|KerbMat)$/i

/**
 * Only genuinely two-sided geometry gets DoubleSide. Applying it to every
 * material (the old behaviour) breaks backface culling and shading on the
 * ~600k-triangle track.
 */
export const DOUBLE_SIDED_MATERIAL_PATTERN =
  /tree|straw|leaf|gitter|fence|flag/i

/**
 * Foliage and fencing ship as glTF `alphaMode: OPAQUE`, so their cutout alpha
 * is ignored and tree billboards render as solid black quads. Alpha-testing
 * them fixes that and still lets them write depth and cast shadows. Harmless on
 * textures with no alpha channel — nothing gets discarded.
 */
export const CUTOUT_MATERIAL_PATTERN = /tree|straw|leaf|gitter|fence|flag/i
export const CUTOUT_ALPHA_TEST = 0.5

/** The racing-line overlay ships as OPAQUE despite its RGBA texture. */
export const GROOVE_MATERIAL_PATTERN = /groove/i
export const GROOVE_ALPHA_TEST = 0.01
export const GROOVE_OPACITY = 0.3

/** Painted kerb triangles used for explicit wheel-on-kerb targets. */
export const CURB_MATERIAL_PATTERN = /^KerbMat$/i

/** The low grass cards read as rows of black rectangles at replay distance. */
export const HIDE_GRASS_STRAWS = true
export const GRASS_STRAW_MATERIAL_PATTERN = /grass_straw/i

/**
 * Escape hatch for backdrop geometry that fights the procedural sky.
 *
 * Off by default: despite the name, `GradientMat` in this model is not a sky
 * dome. It is 19k triangles of ground terrain hugging the circuit (bbox
 * 653 x 8 x 1930 m), so hiding it punches a hole in the runoff and you see the
 * blown-out sky horizon through the floor.
 */
export const HIDE_GRADIENT_MESH = false
export const GRADIENT_MESH_PATTERN = /gradient/i

// ------------------------------------------------------------------ car pose

/**
 * Extra yaw about the road normal, radians. The W14's nose points down its
 * local +Z, so 0 aims the nose along the derived forward axis; use Math.PI to
 * spin it 180 degrees.
 */
export const CAR_YAW_OFFSET = 0

/** Slide along the derived forward axis, metres. */
export const CAR_FORWARD_NUDGE: number = 0

/** Slide along the derived right axis, metres. Positive is the car's right. */
export const CAR_LATERAL_NUDGE: number = 0.325

/** Lift above the road surface so the floor doesn't z-fight the asphalt. */
export const CAR_GROUND_EPSILON = 0.004

/**
 * Visual route phase at official lap time zero. `laps.date_start` is slightly
 * approximate: the transformed lap-22 path crosses the GLB timing line at
 * 71.553294 s, or -446.706 ms on the closed route. The onboard opens 5.2 s
 * earlier, which therefore maps to the exit of T13 at route time 66.353294 s.
 * This remains one adjustable calibration control if the source edit changes.
 */
export const REPLAY_START_ROUTE_TIME_MS = -446.706

/** Put the T13 opening pose just inside the asphalt while retaining the kerb. */
export const REPLAY_LATERAL_NUDGE = 0

/**
 * Keep the full car footprint on the modeled racing surface. OpenF1 location
 * samples are useful for lap progress, but their left/right placement is not
 * precise enough to trust at the white line. The replay route is therefore
 * retained wherever it is valid and eased inward only where it crosses the
 * road corridor.
 */
export const REPLAY_TRACK_CORRIDOR_ENABLED = true

/** Half the 2.01 m W14 width plus 49.5 cm for curved-footprint tolerance. */
export const REPLAY_TRACK_CORRIDOR_MARGIN_METERS = 1.5

/**
 * Manual-only distance the car centre may pass a white line. It is capped so
 * the opposite wheel pair still stays inside by `REPLAY_WHITE_LINE_TIRE_INSET_METERS`.
 * The automatic replay line keeps the full safety margin.
 */
export const REPLAY_CALIBRATION_WHITE_LINE_ALLOWANCE_METERS = 0.65

/** Maximum lateral search from the transformed OpenF1 route, metres. */
export const REPLAY_TRACK_CORRIDOR_SEARCH_METERS = 24

/** Exclude connected aprons/runoff from the usable left/right track width. */
export const REPLAY_TRACK_CORRIDOR_MAX_WIDTH_METERS = 15

/** Resolution used to locate the two road edges on each route cross-section. */
export const REPLAY_TRACK_CORRIDOR_SCAN_STEP_METERS = 0.25

/** Precomputed cross-section spacing; small enough to follow Montréal kerbs. */
export const REPLAY_TRACK_CORRIDOR_SAMPLE_SPACING_METERS = 1.8

/** Number of constrained smoothing passes over the closed lateral route. */
export const REPLAY_TRACK_CORRIDOR_SMOOTHING_PASSES = 20

/** Maximum sideways movement per metre forward; prevents chicane snaps. */
export const REPLAY_TRACK_CORRIDOR_MAX_LATERAL_SLOPE = 0.58

/** A calibration point eases back to the groove within this route distance. */
export const REPLAY_RACING_LINE_ANCHOR_INFLUENCE_METERS = 72

/** Ease into and out of an audited curb-contact window over this distance. */
export const REPLAY_CURB_TRANSITION_METERS = 32

/** Outer tire tread sits this far inside the painted white line, metres. */
export const REPLAY_WHITE_LINE_TIRE_INSET_METERS = 0.18

/** Default white-line ↔ kerb target mix when a contact omits `blend`. */
export const REPLAY_CURB_DEFAULT_BLEND = 0.68

/** Maximum along-track correction used to pair footage with a modeled curb. */
/** Cap along-track curb pairing. Large values used to warp lap progress and reverse the car; display progress is no longer warped, so a moderate search is safe. */
export const REPLAY_CURB_PHASE_SEARCH_METERS = 28

/** Approximate W14 wheel-center distance from the chassis centre line. */
export const REPLAY_WHEEL_CENTER_HALF_TRACK_METERS = 0.82

/** Approximate axle distance from the W14's longitudinal centre, metres. */
export const REPLAY_WHEEL_CENTER_HALF_WHEELBASE_METERS = 1.8

/** Set false (or open the app with `?motion=raw`) to compare old movement. */
export const REPLAY_MOTION_SMOOTHING = true

/** Never let the display spline wander far from the measured linear route. */
export const REPLAY_SPLINE_MAX_DEVIATION = 3

/** A wider tangent window suppresses heading noise without delaying the clock. */
export const REPLAY_HEADING_WINDOW_MS = 360

/** Route distance sampled on each side of the car to stabilize its yaw. */
export const REPLAY_HEADING_HALF_DISTANCE_METERS = 5

/** Suppress residual mesh-normal/yaw chatter on the rendered car body. */
export const CAR_ORIENTATION_RESPONSE_SECONDS = 0.05

/**
 * Montréal is effectively flat at this visual scale. Adjacent GLB road
 * triangles contain discontinuous normals, so banking against them causes a
 * visible one-frame roll kick near the end of the lap.
 */
export const REPLAY_SURFACE_BANKING = false

/**
 * Optional world-space [x, z] spawn override. When set, the car is dropped
 * straight down onto the asphalt below that point and aligned to whatever face
 * it lands on, instead of using the largest-triangle search. Null by default so
 * the pose stays purely geometry-derived.
 *
 * Measured spots in this model, if the derived one ever reads badly:
 *   [280.4, 891.6] — start/finish straight, 21 m of AsphaltMat with the pit
 *                    lane on one side and a painted line and kerb on the other.
 *   [322.7, 940.9] — pit apron, a 25 x 93 m open expanse of tarmac.
 */
export const CAR_SPAWN_XZ: readonly [number, number] | null = [280.4, 891.6]

// -------------------------------------------------------------------- camera

/**
 * Default full-bleed view: FOM-style T-cam on the airbox looking forward.
 *
 * OpenF1 for this lap already supplies `location` (x/y/z plane, ~3.7 Hz, no
 * reliable lateral) and `car_data` (speed/rpm/gear/throttle/brake/drs). There
 * is no camera pose, steering angle, or onboard mount API. Weather / position /
 * stints do not help T-cam geometry. Sector times from `/laps` are useful for
 * timing checks only — do not invent fake camera data.
 */
/**
 * FOM T-cam FOV. NDC-audited at 11.5s: 85° keeps halo in the lower third
 * (y≈-0.52) and the wheel on-screen (y≈-0.82) with usable tire spread.
 */
export const CAMERA_FOV = 85
export const CAMERA_NEAR = 0.05
export const CAMERA_FAR = 15000

/**
 * Forward FOM T-cam / airbox mount in car-local metres (W14 GLB: nose = +Z,
 * road = +Y≈0). The supplied Russell footage is this view: helmet, halo and
 * front tyres are visible. The model's central `camera_wing` bounding box ends
 * at (x=0, y=1.190, z=0.057). The broadcast unit has separate forward and
 * rear lenses; the forward lens is on the left half, so we use an 80 mm
 * left offset from that centred housing. Negative BACK = lens forward of the
 * airbox origin. FOV and pitch remain
 * video-calibrated: neither is present in OpenF1 nor published by FOM.
 * Live tune: `?tcam=back,height,lookH,lookF,fov`
 */
export const ONBOARD_CAMERA_BACK = -0.057
export const ONBOARD_CAMERA_HEIGHT = 1.19
/**
 * The GLB labels its physical left-side mirror geometry at positive X. Keep
 * this positive so the forward lens is actually left of the car in the render.
 */
export const ONBOARD_CAMERA_LATERAL = 0.08
/** Local look target: down-pitch so the wheel sits low under the halo. */
export const ONBOARD_LOOK_HEIGHT = 0.4
export const ONBOARD_LOOK_FORWARD = 9

/** Escape hatch: `?camera=chase` — previous third-person. */
export const CHASE_DISTANCE = 11.5
export const CHASE_HEIGHT = 3.8
export const CHASE_LATERAL_OFFSET = 0
export const CAMERA_TARGET_HEIGHT = 0.6
export const CAMERA_TARGET_FORWARD = 1.1

/** Optional `?camera=overhead` calibration view, metres above the car. */
export const OVERHEAD_CAMERA_HEIGHT = 42

/** Smooth rotation/banking without lagging the camera behind a 300 km/h car. */
export const CAMERA_HEADING_RESPONSE_SECONDS = 0.075
export const CAMERA_UP_RESPONSE_SECONDS = 0.14

/** A larger clock jump is a seek; snap instead of easing across the circuit. */
export const CAMERA_SEEK_THRESHOLD_SECONDS = 0.2

/** Alias for playback-clock seek detection (same threshold as camera seeks). */
export const PLAYBACK_SEEK_THRESHOLD_SECONDS = CAMERA_SEEK_THRESHOLD_SECONDS

/** Hard-resync the monotonic clock when video drift exceeds this many seconds. */
export const PLAYBACK_MAX_DRIFT_SECONDS = 0.15

/** Gentle correction time constant toward video lap time while playing. */
export const PLAYBACK_DRIFT_CORRECTION_SECONDS = 0.25

/** Fast position filter — removes jitter without visible lag behind video. */
export const REPLAY_POSITION_RESPONSE_SECONDS = 0.028

/** Gentler lateral filter — softens curb-to-track transitions without lagging video. */
export const REPLAY_LATERAL_RESPONSE_SECONDS = 0.095

/** Enable motion diagnostics with `?motion=debug` in the URL. */
export function isMotionDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('motion') === 'debug'
}

// ------------------------------------------------------------------ lighting

/**
 * Direction from the car toward the sun, ~31 degrees elevation.
 *
 * Elevation is the single biggest lever on how the scene reads. The Preetham
 * sky model gets enormously bright near midday, so a high sun clips to flat
 * white at any exposure the track looks right at. Mid-afternoon keeps the sky
 * blue and gives the car a shadow with some length to it.
 */
export const SUN_DIRECTION: readonly [number, number, number] = [0.5, 0.52, 0.7]

/** How far up SUN_DIRECTION the light is parked, metres. */
export const SUN_DISTANCE = 140

export const SUN_INTENSITY = 4.6
export const SUN_COLOR = '#fff3e0'

export const AMBIENT_INTENSITY = 0.12
export const HEMI_SKY_COLOR = '#9dc2e8'
export const HEMI_GROUND_COLOR = '#57514a'
export const HEMI_INTENSITY = 0.8

// -------------------------------------------------------------------- shadows

/** Half-size of the sun's shadow box, metres. The box follows the car. */
export const SHADOW_EXTENT = 18
export const SHADOW_MAP_SIZE = 2048
export const SHADOW_BIAS = -0.0004
export const SHADOW_NORMAL_BIAS = 0.004

// ---------------------------------------------------------- sky / atmosphere

/**
 * Tuned against the sky rather than the track: three's Preetham sky outputs
 * far above display range, so anything near 1.0 renders it as white paper.
 * SUN_INTENSITY carries the track back up to a sunny level from here.
 */
export const TONE_MAPPING_EXPOSURE = 0.62

/**
 * Sky dome edge length. Must clear the ~7.2 km track bbox yet keep its corners
 * inside CAMERA_FAR: half-extent 8000 m, corners at 8000 * sqrt(3) ~= 13.9 km.
 */
export const SKY_DISTANCE = 16000
export const SKY_TURBIDITY = 1.75
export const SKY_RAYLEIGH = 1.7
export const SKY_MIE_COEFFICIENT = 0.002
export const SKY_MIE_DIRECTIONAL_G = 0.82

/**
 * Three r185's Preetham sky includes a procedural, texture-free cloud field.
 * Keep the scale broad enough to read as weather rather than smoke, with a
 * broken-cloud coverage that leaves plenty of saturated blue visible. Time is
 * advanced in TrackScene so the layer drifts almost imperceptibly while the
 * replay is open.
 */
export const SKY_CLOUD_SCALE = 0.0004
export const SKY_CLOUD_SPEED = 0.000002
export const SKY_CLOUD_COVERAGE = 0.34
export const SKY_CLOUD_DENSITY = 0.88
export const SKY_CLOUD_ELEVATION = 0.26

/** Matches the sky's horizon so the 5 km skyline blockout doesn't read flat. */
export const FOG_COLOR = '#aac7de'
export const FOG_DENSITY = 0.00012

// ---------------------------------------------- car reflections (offline env)

/** Cube resolution for the inline Lightformer environment. Keep it modest. */
export const ENV_RESOLUTION = 192
