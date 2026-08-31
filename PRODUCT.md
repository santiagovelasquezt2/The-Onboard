# The-Onboard — Product definition

Product name and repository: `The-Onboard`.

## What it is

A **historical** F1 onboard replay: one golden lap, with **onboard video** and a **3D twin** on the same playhead. Telemetry from [OpenF1](https://openf1.org) stays honest to that clock — no invented passes, no live race control.

Audience for this doc: Santiago + agents building the project (and later the README / interview story).

## Golden lap (v1)

| Field | Value |
| --- | --- |
| Driver | George Russell (OpenF1 `driver_number` **63**) |
| Session | 2024 Canadian GP Qualifying — Circuit Gilles Villeneuve (Montreal) |
| Lap | Q3 pole flyer — OpenF1 **lap 22**, duration **72.000s** (`1:12.000`); pin this onboard lap, not a faster Q2 row |
| OpenF1 | Confirmed `session_key` **9527**; ingest writes `data/replays/2024-montreal-q-d63-lap22.json` with clipped `car_data` / `location` streams |
| Video | Pinned release file (Pirelli / F1 pole onboard). User supplies and deliberately commits it. **App does not scrape.** |

## v1 UI (locked wireframe)

- Top: nav bar
- Top-left: onboard camera (HTML5 video)
- Rest: 3D scene — car on track, **defaults to a car-local FOM-style TV Pod view**; third person is the escape view
- Shared playhead: play / pause / scrub / speed; video, 3D pose, and telemetry agree at time *t*

## Assets (v1)

| Role | Source | Notes |
| --- | --- | --- |
| Track | Sketchfab — Circuit Gilles Villeneuve Montreal 2019 layout (CC BY) | Decimate for web; align mesh to OpenF1 `location` plane |
| Car | Sketchfab — AMG W14 S1 (CC BY-NC; credit vecarz / MattsActuallyUsefulModels) | 2023 stand-in for 2024; label if needed. Non-commercial only. |
| Video | User-supplied MP4 (Pirelli 2024 Canada pole lap) | Pinned in the release manifest and deployed with the app |

## Tech stack (locked)

| Layer | Choice |
| --- | --- |
| App | Vite + React + TypeScript |
| 3D | Three.js + React Three Fiber + drei |
| Video | HTML5 `<video>` |
| Data | CLI ingest → compact **replay file**; UI reads cache only (not OpenF1 at runtime) |
| Run | **Local first**; public deploy later |

## In scope (v1)

- One driver, one lap, one track
- Join OpenF1 samples to the lap / session clock
- Sync video ↔ telemetry ↔ 3D car pose
- Toggle between recorded telemetry and clearly labelled, derived vehicle-motion physics: longitudinal, lateral, and combined G
- Offline-friendly demo via replay file + bundled release video
- Dark, quiet garage feel (not MultiViewer / esports chrome)

## Out of scope (v1)

- Live / paid OpenF1
- Two-car compare (same-time or same-place)
- Individual tyre-force / tyre-load heatmaps, downforce, suspension, or grip-use estimates
- Video scraping or committing F1 footage
- Detached third-person camera as the default
- Multi-session catalog / “three tracks” product
- Team radio, betting, race-control clone

## Done means

You can open the local app, play Russell’s Montreal pole lap, and **video + TV Pod 3D + telemetry / derived vehicle motion stay aligned** on one playhead — including when scrubbing and switching workbook views. Gaps and sync disagreements are visible, not papered over.

## Interview one-liner

Historical onboard twin: OpenF1 samples and a pinned pole-lap video on one honest clock — not a live feed, not a MultiViewer clone.
