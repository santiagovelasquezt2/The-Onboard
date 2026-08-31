# Production release contract

Production builds copy only the files declared in `config/runtime-assets.json`
into a generated `.release/public` directory. Vite uses that directory for
builds, so local source models, Blender files, backups, and derived textures
cannot enter `dist` through `public/`.

The runtime release contains the Montreal track, W14 car, glass helmet, golden
replay JSON, Basis transcoder, pinned onboard video, and all three landing
reels. The four MP4s are exact manifest assets and ship by default.

Every app artifact also includes `THIRD_PARTY_NOTICES.txt` plus Vite's generated
`THIRD_PARTY_LICENSES.md`. Together they carry the model, OpenF1, UI, and exact
bundled dependency notices without adding an in-app credits route; they stay
with the app even when runtime assets use a separate CDN.

## Required checks

Use the pinned Node and npm versions from `.nvmrc` and `package.json`, then run:

```sh
npm ci
npm run verify
```

CI also runs `npm run release:git-assets` after checkout. That gate fails if
required runtime assets are absent from Git or if any other file under the
runtime media, replay, or Basis paths is tracked.

`npm run build` stages the manifest allowlist, builds the app, verifies every
staged hash and size, rejects unexpected deploy files, and enforces a 160 MiB
artifact budget. It also copies the built app shell to `dist/404.html`; Vercel
serves that file with HTTP 404 for unmatched paths without rendering a custom
fallback page. Output verification requires `404.html` to remain byte-identical
to `index.html`. The generated `.release/` and `dist/` directories stay ignored.

## Runtime environment

- With no asset environment variables, track, car, helmet, replay, Basis,
  onboard video, and landing reels are same-origin release files.
- `VITE_ASSET_BASE_URL` may point at an immutable HTTPS CDN release root. When
  set, all runtime assets, including Basis, are excluded from the app artifact.
- `VITE_REPLAY_SHA256` is required with `VITE_ASSET_BASE_URL` and must equal the
  golden replay digest in `config/runtime-assets.json`.
- `VITE_ONBOARD_VIDEO_URL` and the three `VITE_LANDING_REEL_*_URL` variables may
  override the bundled videos with separately hosted copies.

Neither `.env` files nor local media outside the exact allowlist may be
committed or uploaded. `.vercelignore` applies the same boundary to CLI
deployments.

The Vercel Content Security Policy intentionally permits `'unsafe-eval'` in
`script-src` and `blob:` workers because the pinned, self-hosted Basis
transcoder uses the JavaScript `Function` constructor inside its KTX2 worker.
Removing either allowance leaves Three.js waiting at 97% while parsing the
track. Hosted smoke enforces this compatibility contract. Replace the
transcoder before tightening that directive.

## Post-deployment smoke

The `Production smoke` workflow runs after a successful GitHub Production
deployment status. It can also be dispatched manually with an HTTPS URL. The
dependency-free check verifies `/`, `/hero`, and `/replay`, security
headers, immutable hashed bundles, and every manifest asset without downloading
the large GLBs or videos. MP4 checks also require the correct content type and
working byte ranges for playback and scrubbing. It requires real HTTP 404
responses with the compiled app shell for `/driving-line-lab` and an
unrecognized canary route; an HTML 200 fallback fails the release smoke.

Before production promotion, also cold-load `/replay` in Chrome and confirm the
replay shell appears directly while the bundled video, textured track, and car
assets become ready. Exercise
play/pause, Space, scrub, playback rate, Data/Physics, and both camera modes;
the console must contain no errors.

If runtime files are hosted separately, set the repository variable
`VITE_ASSET_BASE_URL` or provide the manual `asset_base_url` input so smoke HEAD
checks target the immutable CDN root.
