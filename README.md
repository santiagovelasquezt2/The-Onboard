# TheOnboard

Historical F1 onboard replay (Vite + React). Telemetry comes from a **CLI ingest** into `data/replays/`, mirrored to `public/replays/` for the browser — the UI reads that cache only and must **not** call OpenF1 at runtime.

## Ingest (OpenF1 → replay file)

```bash
cd scripts/ingest && npm install && npm run pull
# or from repo root (after scripts/ingest install):
npm run ingest:pull
```

Writes e.g. `data/replays/2024-montreal-q-d63-lap22.json` and its browser-served mirror. Rate limits / 429 backoff are future CLI work. See `scripts/ingest/README.md` and `data/replays/README.md`.

## Racing-line calibration

Open `http://localhost:5173/?calibrate=1` while the dev server is running.
The app switches the 3D view overhead and adds a short section recorder. The
lap is split into nine practical driving chunks — corner complexes and straights
rather than the official three timing sectors.

1. Pick a section with **Previous** / **Next**. The app pauses on that
   section's start. The next section inherits the saved exit from the section
   before it, so the line stays continuous.
2. While paused, use **Move left** / **Move right** (or `A` / `D`, `←` / `→`)
   to position the entry. This is a shared boundary edit: when a previous
   section exists, its exit moves with the next section's entry.
3. Use **Camera distance** whenever you need a closer or wider read on the
   car's corner placement. It changes only the overhead view, not the car or
   the take.
4. Choose `0.1×` or `0.25×`, then click **Record section** (or press `R`). Hold
   `A` / `D`, `←` / `→`, or the steering buttons to drive the car. Releasing
   holds the current lateral position.
5. Recording stops and saves automatically at the section endpoint. Use
   **Review section** to play just that chunk, **Redo section** to replace it,
   then move to the next one. `Esc` cancels an unfinished take.

Each take is stored locally by section. Finished chunks remain authoritative;
unrecorded gaps ease back to the existing groove/curb fallback. Manual driving
has an extra 0.65 m of white-line allowance beyond the normal safe corridor, so
two wheels can overlap the line, but the car centre still cannot reach runoff or
a nearby access road. The former freeform local draft is left untouched rather
than being guessed into the new section layout.

### Audited curb contacts

The Russell onboard has also been reviewed frame-by-frame. Sixteen confident
tire-on-curb windows are stored in `src/curbContacts.ts`. During those windows
the renderer resolves the matching `KerbMat` segment, places the corresponding
wheel over it, and eases in/out without changing the shared video clock. The
source video's left/right convention is preserved for review while being
converted to the track model's mirrored lateral basis internally.

The curb targets remain part of the rendered fallback line and road-boundary
checks; the simplified recorder does not expose separate curb-edit controls.

## Driving Line Lab

Open `http://127.0.0.1:5173/driving-line-lab` while the dev server is running.
This is a separate contact calibration workflow that starts with 28 boxes; it
can be expanded to 128 boxes and does not replace the nine-section recorder
above.

Pick any numbered box, pause where the real car reaches that contact,
position the 3D car with `A` / `D` or `←` / `→`, choose **White line** or
**Curb**, or **Ref point**, and mark it. Use **Add contact box** to insert a
new box immediately after the selected contact, or select a box and remove it;
later boxes renumber automatically
and the change can be undone. A saved box can be selected later in any order; the Lab
pauses and returns to its saved lap time, lateral position, and contact type so
marking again updates that exact point. A pass is complete when every box in
that pass is filled but stays editable, and **Start a new pass** preserves the
previous attempt and its own box count.

In the aerial positioning view, the real footage stays 0.5 seconds ahead of the
3D car. **Compare 3D onboard** lets you align both views. The 3D comparison
starts 0.10 seconds ahead to compensate for visible render delay; use **3D
comparison timing** to adjust it from 0.50 seconds behind to 0.50 seconds ahead
in 0.01-second steps. The setting is saved in this browser and does not change
aerial positioning timing. The green track line is a local preview of the
selected pass. Browser autosave and optional workspace JSON exports remain
separate from the accepted driving line.

### Proposed onboard review

The saved 64-mark pass in `data/calibration-runs/` is also available as a
non-destructive production proposal on the normal replay at
`http://127.0.0.1:5173/`. The real onboard remains in the top-left and remains
the master clock. The navbar's pill switcher changes the main 3D feed between
**Current line**, **Proposed onboard 1**, and **Proposed onboard 2**, preserving
the side-by-side comparison and the first reviewed fit.

The proposal is a bounded periodic line rather than a path through every dot.
Curb contacts and the last reference cluster before each curb carry the most
weight; ordinary straight references are the flex zones that preserve a smooth
lap. A local curvature allowance lets the fit spend its sharper movement at
real corner targets instead of cutting the apex. The green path is the fitted
line and the colored markers are the original 64 observations. The proposal
uses the current +0.10-second 3D comparison correction and remains separate
from the accepted section calibration.

Proposed onboard 2 is additive: onboard 1 is frozen and remains selectable.
The second revision locally improves T5, adds T6 and T9-exit wall clearance,
pulls T8/T9/T14 closer to their recorded curb positions, and corrects the T10
entry. Its corrections use smooth, compact route windows; T13, the good T14
exit, and unrelated straights retain onboard 1's line.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
