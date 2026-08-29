# Russell glass-shell helmet

- Source archive: `f1-helmet-austrian-gp-2018.zip` (`source/000001474741.glb`).
- Rebuilt from the untouched source as a monochrome optical-glass/frosted hero asset. The output root remains `RussellGlassHelmet`, with `HelmetShell`, `Visor`, `AeroClear`, `Trim`, `Detail`, and `Number63` children.
- The broken speaker-textured chin insert `Compound.015` was removed and replaced by two clean, closed ring/disc grilles with three solid slats each.
- The fragmented rear hardware (`Face.006` through `Face.125`, plus `Face.129`) was removed. Both lower-rear mounts are now closed opaque Trim solids: intersecting collars, pucks, rings, and center caps with recalculated outward normals.
- `Number63` is a bilateral exterior mesh made from a thick outer outline and a separate thinner inset outline. Both layers are hollow, forward-italic, shell-projected, slightly proud of the surface, opaque dark frosted grey, and non-emissive.
- The leading edge is computed from each side's visor and pivot-trim bounds and placed immediately behind that hardware. No stripe or speed-line geometry is included.
- Headless QA reimports the GLB, checks bilateral placement, verifies that only the 12 outline components remain, and renders a focused side view to `tmp/helmet-austrian-2018/qa-63-side.png`.
- Source paint/livery textures, UV layers, vertex colors, custom split normals, and embedded images are stripped. `Compound.006` remains excluded as interior lining.
- Generated locally by `tmp/helmet-austrian-2018/fix_clips_and_63.py`; the large GLB stays gitignored. Supply it locally as `public/media/helmet/russell-glass-shell.glb`.

## Attribution

TODO: recover the source ZIP listing/readme and record the original Sketchfab model URL, author, and confirmed license before publication.
