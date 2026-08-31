# Local media assets (TheOnboard)

Vite serves files under `public/` at the site root. Place local assets here so the app can load them at `/media/...` URLs.

| Asset | Disk path | App URL |
| --- | --- | --- |
| Onboard video | `public/media/onboard.mp4` | `/media/onboard.mp4` |
| Landing sequence videos | `public/media/landing/reel{1,2,3}.mp4` | `/media/landing/reel{1,2,3}.mp4` |
| Track source GLB | `public/media/track/montreal-enhanced.glb` | local build input |
| Track runtime GLB | `public/media/track/montreal-runtime-v2.glb` | `/media/track/montreal-runtime-v2.glb` |
| Car source GLB | `public/media/car/amg-w14.glb` | local build input |
| Car runtime GLB | `public/media/car/amg-w14-runtime-v2.glb` | `/media/car/amg-w14-runtime-v2.glb` |
| Helmet glass shell | `public/media/helmet/russell-glass-shell.glb` | `/media/helmet/russell-glass-shell.glb` |

The 3D scene expects the two `*-runtime-v2.glb` files. Generate them from the
local source assets with `npm run assets:optimize`.
The three landing reels drive the muted horizontal film sequence on `/` and
`/hero` in the order `reel1`, `reel2`, `reel3`.

The four MP4s and exact runtime GLBs in the release manifest are committed and
ship with production. Source models, Blender files, backups, and any other
working media remain ignored.

---

## 1. Onboard video

To replace the pinned Pirelli pole-lap file, copy the approved source into place:

```bash
cp "/path/to/your/onboard.mp4" public/media/onboard.mp4
```

The app expects **`/media/onboard.mp4`**. After replacing it, update its byte
size and SHA-256 in `config/runtime-assets.json`. Do not scrape or download
video from the web in-app.

### Timed-lap window

The supplied Pirelli clip has pre-lap and post-lap footage. The replay does
not expose the whole file as its timeline: it maps OpenF1 lap time `0.000s` to
video time `5.200s` and plays exactly the official `72.000s` lap window. If
you replace the MP4 with another edit, update `ONBOARD_LAP_START_SECONDS` in
`src/features/replay/lapWindow.ts` after locating the frame where the car crosses the timing
line. The replacement clip must include the whole timed lap after that frame.

---

## 2. Track model (manual Sketchfab download)

**Model:** [Circuit Gilles Villeneuve Montreal 2019 layout](https://sketchfab.com/3d-models/circuit-gilles-villeneuve-montreal-2019-layout-5875d33d5ddb44f4a6c1188ed6776fa8)  
**Author:** Dave Love  
**License:** CC BY 4.0 (attribution required)

Steps (Sketchfab requires a logged-in account; downloads are not automated):

1. Open the model page and sign in to Sketchfab.
2. Download the model (prefer **glTF** / **.glb** if offered).
3. Unpack if needed and save the main file as **`public/media/track/montreal.glb`**.
4. Keep any companion `.bin` / texture files next to the glTF so relative paths resolve.

The enhanced working asset is `montreal-enhanced.glb`. The optimization build
retiles its preserved source surface into 250 m spatial cells, then writes
`montreal-runtime-v2.glb`. It keeps all 573,161 triangles, UVs, material face
assignments, and replay coordinates.

**Credit:** Circuit Gilles Villeneuve Montreal 2019 layout by Dave Love, licensed under CC BY 4.0.

---

## 3. Car model (manual Sketchfab download)

**Model:** [AMG W14 S1](https://sketchfab.com/3d-models/amg-w14-s1-wwwvecarzcom-057679fc5a32411fa7fd6e43c16badae)  
**Credit:** vecarz / MattsActuallyUsefulModels  
**License:** CC BY-NC 4.0 — **non-commercial use only**

Steps:

1. Open the model page and sign in to Sketchfab.
2. Download (prefer **glTF** / **.glb**).
3. Place the main file as **`public/media/car/amg-w14.glb`**.
4. Keep textures / `.bin` beside the glTF if separate.

**Notes:**

- The W14 mesh is a **2023** stand-in for Russell’s **2024** Merc in v1.
- Livery textures in `amg-w14.glb` were restyled toward the **2024 W15 MTL** look: muted aluminium nose (`mercedes_paint_nose` base ~`#555B61`, metalness ~0.38 / roughness ~0.56), black body, Petronas teal, INEOS red accents, and George Russell **#63** in signature blue (`#00B4E4`) instead of Hamilton’s yellow **#44**. The number atlas keeps a single cyan **63** (outline/ghost faces removed); runtime `prepareCar` must not apply body clearcoat to `mercedes_paint_nose` or the silver washes white under the scene env map.
- Original Sketchfab textures are kept as `amg-w14.hamilton-backup.glb` for reference.
- CC BY-NC means attribution **and** no commercial use. Fine for a personal / portfolio interview project; not for a commercial product without a different license or asset.

**Credit:** AMG W14 S1 by vecarz / MattsActuallyUsefulModels, licensed under CC BY-NC 4.0.

---

## 4. Helmet glass shell

The `/hero` prototype loads `public/media/helmet/russell-glass-shell.glb`. It was cleaned from the local source archive `f1-helmet-austrian-gp-2018.zip`, with its paint and textures stripped for the glass treatment. See [`public/media/helmet/README.md`](helmet/README.md) for the mesh roles and outstanding attribution note.

The exact runtime GLB is committed as a release asset; its source archive and
working copies remain ignored.

---

## 5. Performance tip

Run `npm run assets:optimize` after changing either production GLB. The build is
non-destructive: it copies the track `.blend`, exports fine spatial tiles, keeps
the original texture dimensions, encodes high-quality UASTC/KTX2 mipmaps, and
applies Meshopt geometry compression. Runtime rendering batches track tiles and
static opaque car pieces into material-level multi-draw buffers; wheel
assemblies and transparency-sensitive pieces remain independent.
