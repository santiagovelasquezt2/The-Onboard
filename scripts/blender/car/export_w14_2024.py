"""Export the validated color-only W14/W15 livery working file to GLB."""

from __future__ import annotations

import os
from pathlib import Path

import bpy


REPO_ROOT = Path(__file__).resolve().parents[3]
EXPORT_PATH = Path(
    os.environ.get(
        "W14_EXPORT_PATH",
        REPO_ROOT / "tmp/mercedes-2024-livery/final/amg-w14-2024-candidate.glb",
    )
)


def main() -> dict[str, object]:
    unexpected = [obj.name for obj in bpy.data.objects if obj.name.startswith("LiveryValidation_")]
    if unexpected:
        raise RuntimeError(f"Validation-only objects present in export scene: {unexpected}")

    EXPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT_PATH),
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_animations=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_attributes=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )

    return {
        "path": str(EXPORT_PATH),
        "bytes": EXPORT_PATH.stat().st_size,
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "blender_version": bpy.app.version_string,
    }


if __name__ == "__main__":
    export_report = main()
