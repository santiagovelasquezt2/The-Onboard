# Local media assets (TheOnboard)

Vite serves files under `public/` at the site root. Place local assets here so the app can load them at `/media/...` URLs.

| Asset | Disk path | App URL |
| --- | --- | --- |
| Onboard video | `public/media/onboard.mp4` | `/media/onboard.mp4` |
| Landing reels | `public/media/landing/reel{1,2,3}.mp4` | `/media/landing/reel{1,2,3}.mp4` |
| Track GLB | `public/media/track/montreal.glb` | `/media/track/montreal.glb` |
| Car GLB | `public/media/car/amg-w14.glb` | `/media/car/amg-w14.glb` |
| Helmet glass shell | `public/media/helmet/russell-glass-shell.glb` | `/media/helmet/russell-glass-shell.glb` |

The 3D scene expects those exact filenames.
The three landing reels are local, muted looping backgrounds for the home page.

Everything in this folder is gitignored except this README and `.gitkeep` files. You must supply video and 3D models locally.

---

## 1. Onboard video

Copy the local Pirelli pole-lap file into place:

```bash
cp "/Users/santiagovelasquez/Downloads/George Russell's Pole Lap _ 2024 Canadian Grand Prix _ Pirelli.mp4" \
  "/Users/santiagovelasquez/Desktop/swe/Openf1-garage/public/media/onboard.mp4"
```

The app expects **`/media/onboard.mp4`**. Do not scrape or download video from the web in-app.

### Timed-lap window

The supplied Pirelli clip has pre-lap and post-lap footage. The replay does
not expose the whole file as its timeline: it maps OpenF1 lap time `0.000s` to
video time `5.200s` and plays exactly the official `72.000s` lap window. If
you replace the MP4 with another edit, update `ONBOARD_LAP_START_SECONDS` in
`src/lapWindow.ts` after locating the frame where the car crosses the timing
line. The replacement clip must include the whole timed lap after that frame.

---

## 2. Track model (manual Sketchfab download)

**Model:** [Circuit Gilles Villeneuve Montreal 2019 layout](https://sketchfab.com/3d-models/circuit-gilles-villeneuve-montreal-2019-layout-5875d33d5ddb44f4a6c1188ed6776fa8)  
**Author:** Dave Love  
**License:** CC BY 4.0 (attribution required)

Steps (Sketchfab requires a logged-in account; downloads are not automated):

1. Open the model page and sign in to Sketchfab.
2. Download the model (prefer **glTF** / **.glb** if offered).
3. Unpack if needed and save the main file as **`public/media/track/montreal.glb`** (required name).
4. Keep any companion `.bin` / texture files next to the glTF so relative paths resolve.

**Credit:** Circuit Gilles Villeneuve Montreal 2019 layout by Dave Love, licensed under CC BY 4.0.

---

## 3. Car model (manual Sketchfab download)

**Model:** [AMG W14 S1](https://sketchfab.com/3d-models/amg-w14-s1-wwwvecarzcom-057679fc5a32411fa7fd6e43c16badae)  
**Credit:** vecarz / MattsActuallyUsefulModels  
**License:** CC BY-NC 4.0 — **non-commercial use only**

Steps:

1. Open the model page and sign in to Sketchfab.
2. Download (prefer **glTF** / **.glb**).
3. Place the main file as **`public/media/car/amg-w14.glb`** (required name).
4. Keep textures / `.bin` beside the glTF if separate.

**Notes:**

- The W14 mesh is a **2023** stand-in for Russell’s **2024** Merc in v1.
- Livery textures in `amg-w14.glb` were restyled toward the **2024 W15 MTL** look: muted aluminium nose (solid `mercedes_paint_nose`, ~`#383C41` base with metalness ~0.42 / roughness ~0.55 — not near-white), black body, Petronas teal, INEOS red accents, and George Russell **#63** in signature blue (`#00B4E4`) instead of Hamilton’s yellow **#44**. Nose sponsor logos that sat on silver were darkened for contrast; the number atlas top half is cleared so the nose **63** is not ghosted.
- Original Sketchfab textures are kept as `amg-w14.hamilton-backup.glb` for reference.
- CC BY-NC means attribution **and** no commercial use. Fine for a personal / portfolio interview project; not for a commercial product without a different license or asset.

**Credit:** AMG W14 S1 by vecarz / MattsActuallyUsefulModels, licensed under CC BY-NC 4.0.

---

## 4. Helmet glass shell

The `/hero` prototype loads `public/media/helmet/russell-glass-shell.glb`. It was cleaned from the local source archive `f1-helmet-austrian-gp-2018.zip`, with its paint and textures stripped for the glass treatment. See [`public/media/helmet/README.md`](helmet/README.md) for the mesh roles and outstanding attribution note.

The GLB is intentionally gitignored with the other large media assets, so each checkout must supply it locally at that exact path.

---

## 5. Performance tip

Sketchfab race tracks and F1 cars are often far too dense for real-time web. Before shipping to the browser, open the mesh in **Blender**, decimate / retopo to a sensible poly count, merge materials where possible, and re-export glTF/GLB. Prefer one self-contained `.glb` per asset when practical.
