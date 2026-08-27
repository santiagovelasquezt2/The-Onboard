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

Open `http://127.0.0.1:5176/?calibrate=1` while the dev server is running.
The app switches the 3D view overhead and adds a calibration panel:

1. Play, pause, or scrub to the onboard frame you want to match.
2. Use `−1 frame` / `+1 frame` for exact 50 fps positioning.
3. Nudge left or right in metres. The default line comes from the track
   model's authored racing groove; each point is only a local correction from
   that baseline and does not change the replay clock or start position.
4. Revisit a point to adjust or remove it. Working anchors persist in local
   storage; `Reset nudges` removes every correction and `Copy JSON` exports
   the current set.

The normal replay URL automatically uses the locally saved calibration. The
route is clamped to the modeled asphalt plus kerbs, and the expensive track
cross-sections are cached so repeated checkpoint edits stay responsive.

### Audited curb contacts

The Russell onboard has also been reviewed frame-by-frame. Sixteen confident
tire-on-curb windows are stored in `src/curbContacts.ts`. During those windows
the renderer resolves the matching `KerbMat` segment, places the corresponding
wheel over it, and eases in/out without changing the shared video clock. The
source video's left/right convention is preserved for review while being
converted to the track model's mirrored lateral basis internally.

In calibration mode, use `Prev curb` / `Next curb` to jump through the audit.
The status reads `On curb`, `Approach`, or `Curb miss` from the rendered wheel
position rather than assuming an edgeward offset was successful.

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
