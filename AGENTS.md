## Learned User Preferences
- Do all planning and product fleshing in normal chat prose; do not use AskQuestion, Cursor question UI hooks, or multiple-choice questionnaires.
- Prefer short TLDRs and simple language when explanations get long or abstract.
- Lock the product in chat before system design or scaffolding; discuss and settle tech stack before building UI.
- The project must not be one-shottable by another engineer or LLM (a few prompts still counts as too easy); difficulty should live in correctness (clock, joins, video↔telemetry sync), not UI chrome.
- When researching 3D track assets, present free or open-licensed options only unless paid options are explicitly requested.
- Do not fix replay jank with heavy smoothing that makes the 3D render lag behind the video or cut across corners.
- Align car lateral placement to onboard video cues (tire edges vs white lines/curbs); prefer subtle white-line kisses over forced full-kerb mounts unless footage shows aggressive contact.
- Prefer the default full-bleed 3D view matched to real FOM onboard T-cam framing (halo/tires in frame), not a detached chase cam; keep the camera above the track surface.
- Skip cosmetic motion such as estimated wheel spin unless it looks good at speed (including high-speed blur); static wheels beat fake-looking spin.
- For the landing glass hero, keep type dead-still and let a translucent optical-glass object (helmet) do the motion/refraction; avoid rainbow/liquid-glass, floor planes, and extra lights.

## Learned Workspace Facts
- TheOnboard (workspace Openf1-garage) is a greenfield historical F1 onboard replay product, not live race control.
- Locked v1 scope: 1 driver, 1 lap, 1 track — George Russell’s 2024 Canadian GP Qualifying pole lap (Montreal / Circuit Gilles Villeneuve); OpenF1 `session_key` 9527, driver 63, lap 22.
- Locked v1 UI: full-bleed FOM-style T-cam (car-local mount; escape via `?camera=chase`); onboard video PiP top-left; stacked car-data pills under the PiP; nav strip top-right; shared playhead keeps video, 3D, and telemetry aligned.
- App routes: `/` glass-helmet landing page (`HeroPage`); `/hero` is an alias; `/replay` onboard twin; the three landing reels and pinned onboard MP4 ship as exact release assets.
- Video sources are user-provided and deliberately committed for this release; the app must not scrape or download video itself.
- Two-car compare and g-forces are out of v1 (g-forces deferred).
- Canonical product definition is `PRODUCT.md` at the repo root.
- OpenF1 historical data (2023+) is free; live is paid. `car_data` and `location` are ~3.7 Hz samples; `location` is x/y/z on a session-local plane with no lateral placement; API has no camera pose, steering, or wheel rotation.
- The interview-relevant core is joining event-shaped `laps` to sample streams (`car_data` / `location`) and keeping video, 3D, and telemetry on an honest shared playhead — not cinematic spectacle or a MultiViewer clone.
- Locked stack: Vite + React + TypeScript + React Three Fiber; CLI ingest → replay file; UI reads cache only (not OpenF1 at runtime); local-first, deploy later.
- v1 3D assets: track `public/media/track/montreal.glb` (Sketchfab Montreal 2019, CC BY); car `public/media/car/amg-w14.glb` (W14 2023 mesh stand-in, Blender-recolored toward 2024 Mercedes MTL with Russell blue #63 — not Hamilton yellow #44); glass helmet prototype `public/media/helmet/russell-glass-shell.glb`.
- Replay calibration locks: `REPLAY_START_ROUTE_TIME_MS = -446.706`; 16 curated curb-contact windows in `src/features/replay/calibration/curbContacts.ts` with per-contact white-line/kerb blend strengths from onboard video audit.
