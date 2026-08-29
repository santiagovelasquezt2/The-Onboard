"""Background Blender repair for Russell glass-shell helmet meshes.

Targets Visor (curtain-fold shimmer) and AeroClear (non-manifold edges).
Keeps HelmetShell / Number63 / Trim / Detail geometry intact.
"""

from __future__ import annotations

import sys

import bpy

GLB_PATH = (
    "/Users/santiagovelasquez/Desktop/swe/Openf1-garage/"
    "public/media/helmet/russell-glass-shell.glb"
)
MERGE_DISTANCE = 0.00015
VISOR_DISSOLVE_ANGLE = 0.035  # radians (~2°) — only tiny coplanar noise


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        if block.users == 0:
            bpy.data.materials.remove(block)


def mesh_objects_matching(token: str) -> list[bpy.types.Object]:
    needle = token.lower().replace(" ", "").replace("_", "").replace("-", "")
    matches: list[bpy.types.Object] = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        name = obj.name.lower().replace(" ", "").replace("_", "").replace("-", "")
        if needle in name:
            matches.append(obj)
    return matches


def count_non_manifold(obj: bpy.types.Object) -> int:
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_non_manifold()
    bpy.ops.object.mode_set(mode="OBJECT")
    return sum(1 for e in obj.data.edges if e.select)


def repair_mesh(obj: bpy.types.Object, *, dissolve: bool) -> dict[str, int | str]:
    before_verts = len(obj.data.vertices)
    before_nm = count_non_manifold(obj)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=MERGE_DISTANCE)
    bpy.ops.mesh.normals_make_consistent(inside=False)

    if dissolve:
        # Soft limited dissolve: only nearly-coplanar faces (visor curtain noise).
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.dissolve_limited(
            angle_limit=VISOR_DISSOLVE_ANGLE,
            use_dissolve_boundaries=False,
            delimit={"NORMAL"},
        )
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)

    bpy.ops.object.mode_set(mode="OBJECT")
    mesh = obj.data
    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = False
    for poly in mesh.polygons:
        poly.use_smooth = True

    after_verts = len(mesh.vertices)
    after_nm = count_non_manifold(obj)

    return {
        "name": obj.name,
        "verts_before": before_verts,
        "verts_after": after_verts,
        "non_manifold_before": before_nm,
        "non_manifold_after": after_nm,
    }


def main() -> int:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)

    print("Imported objects:", [o.name for o in bpy.data.objects if o.type == "MESH"])

    visors = mesh_objects_matching("visor")
    aeros = mesh_objects_matching("aeroclear")

    if not visors:
        print("ERROR: no Visor mesh found", file=sys.stderr)
        return 1
    if not aeros:
        print("ERROR: no AeroClear mesh found", file=sys.stderr)
        return 1

    reports = []
    for obj in visors:
        reports.append(repair_mesh(obj, dissolve=True))
    for obj in aeros:
        reports.append(repair_mesh(obj, dissolve=False))

    for report in reports:
        print("REPAIR", report)

    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_yup=True,
    )
    print(f"Rewrote {GLB_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
