## Learned User Preferences
- Do all planning and product fleshing in normal chat prose; do not use AskQuestion, Cursor question UI hooks, or multiple-choice questionnaires.
- Prefer short TLDRs and simple language when explanations get long or abstract.
- Lock the product in chat before system design or scaffolding; discuss and settle tech stack before building UI.
- The project must not be one-shottable by another engineer or LLM (a few prompts still counts as too easy); difficulty should live in correctness (clock, joins, video↔telemetry sync), not UI chrome.
- When researching 3D track assets, present free or open-licensed options only unless paid options are explicitly requested.
- Do not fix replay jank with heavy smoothing that makes the 3D render lag behind the video or cut across corners.

## Learned Workspace Facts
- TheOnboard (workspace Openf1-garage) is a greenfield historical F1 onboard replay product, not live race control.
- Locked v1 scope: 1 driver, 1 lap, 1 track — George Russell’s 2024 Canadian GP Qualifying pole lap (Montreal / Circuit Gilles Villeneuve); OpenF1 `session_key` 9527, driver 63, lap 22.
- Locked v1 UI: full-bleed third-person 3D; onboard video PiP top-left; nav strip top-right; shared playhead keeps video, 3D, and telemetry aligned.
- Video is a local file the user provides; the app must not scrape or download video itself.
- Two-car compare and g-forces are out of v1 (g-forces deferred).
- Canonical product definition is `PRODUCT.md` at the repo root.
- CHIP-8 was not chosen; Project 1 (rain game / betting) is a separate product — do not merge themes.
- OpenF1 historical data (2023+) is free; live is paid. `car_data` and `location` are ~3.7 Hz samples; `location` is x/y/z on a session-local plane with no lateral placement.
- The interview-relevant core is joining event-shaped `laps` to sample streams (`car_data` / `location`) and keeping video, 3D, and telemetry on an honest shared playhead — not cinematic spectacle or a MultiViewer clone.
- Locked stack: Vite + React + TypeScript + React Three Fiber; CLI ingest → replay file; UI reads cache only (not OpenF1 at runtime); local-first, deploy later.
- v1 3D assets: track `public/media/track/montreal.glb` (Sketchfab Montreal 2019, CC BY); car `public/media/car/amg-w14.glb` (W14 2023 stand-in for 2024, CC BY-NC).
- Replay calibration locks: `REPLAY_START_ROUTE_TIME_MS = -446.706`; 16 curated curb-contact windows in `src/curbContacts.ts`.
