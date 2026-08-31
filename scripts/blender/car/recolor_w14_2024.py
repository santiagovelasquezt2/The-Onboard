"""Apply the 2024 Russell Mercedes palette without modifying geometry.

Primary visual reference:
  image-3.png (real car, Russell 63)

The script remaps existing livery texture colors, keeps all UVs and meshes
intact, adds dedicated PETRONAS-cyan and cockpit-silver paint materials, and
saves the currently open working .blend. The cockpit material is assigned to
existing faces only; no vertices, edges, polygons, transforms, or UVs move.
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE_PATH = os.environ.get(
    "W14_REFERENCE_PATH",
    str(REPO_ROOT / "tmp/mercedes-2024-livery/reference/image-3.png"),
)

PALETTE = {
    "carbon_black": "#0B1014",
    "painted_black": "#11161A",
    "silver": "#BCC6CB",
    "silver_mid": "#98A5AB",
    # The reference car's upper monocoque is a cool, mid-light metallic grey.
    # Keeping this slightly below the brightest texture silver prevents the
    # replay's ACES exposure from washing the cockpit shoulders to white.
    "cockpit_silver": "#A8B0B4",
    "petronas": "#00AFAE",
    # Kept separate so the T-cam-visible caps can be calibrated independently
    # against the onboard PiP without altering every PETRONAS texture pixel.
    "petronas_mirror": "#00AFAE",
    "ineos": "#B51E2E",
    "russell_blue": "#12A8CF",
    "sponsor_white": "#E8ECEF",
    # Deliberately darker than the photographic highlight. The app's ACES
    # exposure and reflection environment lift this toward visible aluminium.
    "nose_silver_factor": "#768188",
}


def hex_to_srgb(value: str) -> np.ndarray:
    value = value.lstrip("#")
    return np.array([int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def srgb_to_linear(values: np.ndarray) -> np.ndarray:
    return np.where(
        values <= 0.04045,
        values / 12.92,
        ((values + 0.055) / 1.055) ** 2.4,
    ).astype(np.float32)


def linear_to_srgb(values: np.ndarray) -> np.ndarray:
    values = np.clip(values, 0.0, None)
    return np.where(
        values <= 0.0031308,
        values * 12.92,
        1.055 * np.power(values, 1.0 / 2.4) - 0.055,
    ).astype(np.float32)


def geometry_signature() -> str:
    """Hash transforms/topology/positions; intentionally excludes materials."""
    digest = hashlib.sha256()
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        digest.update(obj.name.encode("utf-8"))
        digest.update(obj.type.encode("ascii"))
        for value in obj.matrix_world:
            for component in value:
                digest.update(struct.pack("<d", float(component)))
        if obj.type != "MESH":
            continue
        mesh = obj.data
        digest.update(mesh.name.encode("utf-8"))
        digest.update(struct.pack("<III", len(mesh.vertices), len(mesh.edges), len(mesh.polygons)))
        for vertex in mesh.vertices:
            digest.update(struct.pack("<fff", *map(float, vertex.co)))
        for polygon in mesh.polygons:
            digest.update(struct.pack("<II", polygon.loop_start, polygon.loop_total))
    return digest.hexdigest()


def image_rgba(image: bpy.types.Image) -> np.ndarray:
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape((-1, 4))


def write_image_rgba(image: bpy.types.Image, rgba: np.ndarray) -> None:
    image.pixels.foreach_set(rgba.astype(np.float32, copy=False).ravel())
    image.update()
    image.pack()


def target_linear(name: str) -> np.ndarray:
    return srgb_to_linear(hex_to_srgb(PALETTE[name]))


def remap_paint_image(image_name: str) -> dict[str, int]:
    image = bpy.data.images[image_name]
    rgba = image_rgba(image)
    rgb = linear_to_srgb(rgba[:, :3])

    maximum = rgb.max(axis=1)
    minimum = rgb.min(axis=1)
    neutral = (maximum - minimum) < 0.12

    dark = maximum < 0.09
    cyan = (
        (rgb[:, 1] > 0.43)
        & (rgb[:, 2] > 0.43)
        & (rgb[:, 1] > rgb[:, 0] * 1.32)
        & (rgb[:, 2] > rgb[:, 0] * 1.32)
    )
    red = (
        (rgb[:, 0] > 0.34)
        & (rgb[:, 0] > rgb[:, 1] * 1.45)
        & (rgb[:, 0] > rgb[:, 2] * 1.45)
    )
    light_neutral = neutral & (minimum > 0.62)
    mid_neutral = neutral & (maximum > 0.30) & (minimum <= 0.62)

    rgb[dark] = hex_to_srgb(PALETTE["carbon_black"])
    rgb[cyan] = hex_to_srgb(PALETTE["petronas"])
    rgb[red] = hex_to_srgb(PALETTE["ineos"])
    rgb[light_neutral] = hex_to_srgb(PALETTE["silver"])
    rgb[mid_neutral] = hex_to_srgb(PALETTE["silver_mid"])

    rgba[:, :3] = srgb_to_linear(rgb)
    write_image_rgba(image, rgba)
    return {
        "dark": int(dark.sum()),
        "cyan": int(cyan.sum()),
        "red": int(red.sum()),
        "light_neutral": int(light_neutral.sum()),
        "mid_neutral": int(mid_neutral.sum()),
    }


def remap_decal_image() -> dict[str, int]:
    image = bpy.data.images["mercedes_decal_final"]
    rgba = image_rgba(image)
    rgb = linear_to_srgb(rgba[:, :3])
    visible = rgba[:, 3] > 0.02

    maximum = rgb.max(axis=1)
    minimum = rgb.min(axis=1)
    neutral = (maximum - minimum) < 0.10
    white = visible & neutral & (minimum > 0.72)
    yellow = visible & (rgb[:, 0] > 0.65) & (rgb[:, 1] > 0.65) & (rgb[:, 2] < 0.68)
    cyan = (
        visible
        & (rgb[:, 1] > 0.45)
        & (rgb[:, 2] > 0.45)
        & (rgb[:, 1] > rgb[:, 0] * 1.35)
        & (rgb[:, 2] > rgb[:, 0] * 1.35)
    )
    red = (
        visible
        & (rgb[:, 0] > 0.35)
        & (rgb[:, 0] > rgb[:, 1] * 1.5)
        & (rgb[:, 0] > rgb[:, 2] * 1.5)
    )

    rgb[white] = hex_to_srgb(PALETTE["sponsor_white"])
    rgb[yellow] = hex_to_srgb(PALETTE["russell_blue"])
    rgb[cyan] = hex_to_srgb(PALETTE["petronas"])
    rgb[red] = hex_to_srgb(PALETTE["ineos"])
    rgba[:, :3] = srgb_to_linear(rgb)
    write_image_rgba(image, rgba)
    return {
        "white": int(white.sum()),
        "hamilton_yellow_to_russell_blue": int(yellow.sum()),
        "cyan": int(cyan.sum()),
        "red": int(red.sum()),
    }


def set_flat_image_color(image_name: str, color_name: str, respect_alpha: bool) -> int:
    image = bpy.data.images[image_name]
    rgba = image_rgba(image)
    mask = rgba[:, 3] > 0.02 if respect_alpha else np.ones(len(rgba), dtype=bool)
    rgba[mask, :3] = target_linear(color_name)
    write_image_rgba(image, rgba)
    return int(mask.sum())


def principled_node(material: bpy.types.Material) -> bpy.types.ShaderNodeBsdfPrincipled:
    return next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")


def set_material_base_color(material_name: str, color_name: str) -> None:
    material = bpy.data.materials[material_name]
    color = (*map(float, target_linear(color_name)), 1.0)
    principled_node(material).inputs["Base Color"].default_value = color
    material.diffuse_color = color


def assign_cyan_mirror_shells() -> list[str]:
    source = bpy.data.materials["mercedes_paint_nose"]
    material = bpy.data.materials.get("mercedes_paint_2024_cyan")
    if material is None:
        material = source.copy()
        material.name = "mercedes_paint_2024_cyan"
    set_material_base_color(material.name, "petronas_mirror")
    bsdf = principled_node(material)
    bsdf.inputs["Metallic"].default_value = 0.05
    bsdf.inputs["Roughness"].default_value = 0.22
    if bsdf.inputs.get("Coat Weight"):
        bsdf.inputs["Coat Weight"].default_value = 0.65
    if bsdf.inputs.get("Coat Roughness"):
        bsdf.inputs["Coat Roughness"].default_value = 0.18

    assigned = []
    # The small painted shells are Object_149/Object_160. The broader upper
    # caps visible from the T-cam are Object_153/Object_164; keep the mirror
    # glass and the thin carbon support pieces untouched.
    for object_name in ("Object_149", "Object_160", "Object_153", "Object_164"):
        obj = bpy.data.objects[object_name]
        if len(obj.material_slots) != 1:
            raise RuntimeError(f"Unexpected mirror material slot count: {object_name}")
        obj.material_slots[0].material = material
        assigned.append(object_name)
    return assigned


def cockpit_silver_face(obj: bpy.types.Object, polygon: bpy.types.MeshPolygon) -> bool:
    """Select the existing upper nose/monocoque faces visible from the T-cam."""
    world_center = obj.matrix_world @ polygon.center
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    world_normal = (normal_matrix @ polygon.normal).normalized()
    absolute_x = abs(world_center.x)

    # Continue the silver nose rearward from the separately authored nose mesh.
    spear = (
        -1.90 <= world_center.y <= -0.82
        and absolute_x <= 0.19
        and world_center.z >= 0.60
        and world_normal.z >= 0.18
    )

    # Paired upper-monocoque rails and shoulders framing the cockpit. These stop
    # before the sidepod inlet/engine cover so the black carbon areas stay black.
    cockpit_rails = (
        -1.34 <= world_center.y <= -0.30
        and 0.075 <= absolute_x <= 0.50
        and world_center.z >= 0.675
        and world_normal.z >= 0.12
    )
    return spear or cockpit_rails


def assign_cockpit_silver() -> dict[str, object]:
    source = bpy.data.materials["mercedes_paint_nose"]
    material = bpy.data.materials.get("mercedes_paint_2024_cockpit_silver")
    if material is None:
        material = source.copy()
        material.name = "mercedes_paint_2024_cockpit_silver"
    set_material_base_color(material.name, "cockpit_silver")
    bsdf = principled_node(material)
    bsdf.inputs["Metallic"].default_value = 0.34
    bsdf.inputs["Roughness"].default_value = 0.46
    if bsdf.inputs.get("Coat Weight"):
        bsdf.inputs["Coat Weight"].default_value = 0.28
    if bsdf.inputs.get("Coat Roughness"):
        bsdf.inputs["Coat Roughness"].default_value = 0.24

    monocoque = bpy.data.objects["Object_386"]
    if len(monocoque.material_slots) != 1:
        raise RuntimeError("Unexpected upper-monocoque material slot count")
    monocoque.data.materials.append(material)
    for polygon in monocoque.data.polygons:
        polygon.material_index = 0

    # Grow each seed selection to its complete connected surface island. This
    # makes the black/silver boundary follow real panel seams instead of cutting
    # diagonally through the model's triangulation.
    vertex_polygons: dict[int, list[int]] = defaultdict(list)
    for polygon in monocoque.data.polygons:
        for vertex_index in polygon.vertices:
            vertex_polygons[vertex_index].append(polygon.index)

    visited: set[int] = set()
    selected_faces = 0
    selected_components = 0
    for polygon in monocoque.data.polygons:
        if polygon.index in visited:
            continue
        pending = [polygon.index]
        visited.add(polygon.index)
        component: list[int] = []
        while pending:
            polygon_index = pending.pop()
            component.append(polygon_index)
            for vertex_index in monocoque.data.polygons[polygon_index].vertices:
                for neighbor_index in vertex_polygons[vertex_index]:
                    if neighbor_index not in visited:
                        visited.add(neighbor_index)
                        pending.append(neighbor_index)

        if any(
            cockpit_silver_face(monocoque, monocoque.data.polygons[polygon_index])
            for polygon_index in component
        ):
            selected_components += 1
            for polygon_index in component:
                monocoque.data.polygons[polygon_index].material_index = 1
                selected_faces += 1

    # Existing narrow spine and number substrate immediately ahead of the
    # cockpit are already separate meshes, so whole-object material assignments
    # remain color-only and keep the blue 63 on a silver field.
    whole_object_assignments = []
    for object_name in ("Object_66", "Object_388"):
        obj = bpy.data.objects[object_name]
        if len(obj.material_slots) != 1:
            raise RuntimeError(f"Unexpected cockpit material slot count: {object_name}")
        obj.material_slots[0].material = material
        whole_object_assignments.append(object_name)

    return {
        "material": material.name,
        "monocoque_object": monocoque.name,
        "monocoque_selected_faces": selected_faces,
        "monocoque_total_faces": len(monocoque.data.polygons),
        "monocoque_selected_components": selected_components,
        "whole_object_assignments": whole_object_assignments,
    }


def main() -> dict[str, object]:
    geometry_before = geometry_signature()

    report = {
        "reference": REFERENCE_PATH,
        "palette": PALETTE,
        "paint": {
            name: remap_paint_image(name)
            for name in ("mercedes_paint_matte_silver", "mercedes_paint_alpha__Image_9")
        },
        "decals": remap_decal_image(),
        "russell_number_pixels": set_flat_image_color(
            "mercedes_number_final", "russell_blue", respect_alpha=True
        ),
        "halo_band_pixels": set_flat_image_color(
            "driver_color__Image_26", "petronas", respect_alpha=False
        ),
    }

    set_material_base_color("mercedes_paint_nose", "nose_silver_factor")
    report["cyan_mirror_objects"] = assign_cyan_mirror_shells()
    report["cockpit_silver"] = assign_cockpit_silver()

    scene = bpy.context.scene
    scene["livery_reference"] = REFERENCE_PATH
    scene["livery_palette_json"] = json.dumps(PALETTE, sort_keys=True)
    scene["livery_geometry_policy"] = "materials_and_textures_only"

    geometry_after = geometry_signature()
    if geometry_before != geometry_after:
        raise RuntimeError("Geometry signature changed during color-only livery pass")

    report["geometry_signature"] = geometry_after
    report["objects"] = len(bpy.data.objects)
    report["meshes"] = len(bpy.data.meshes)
    report["materials"] = len(bpy.data.materials)
    report["images"] = len(bpy.data.images)

    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    report["saved_blend"] = bpy.data.filepath
    return report


if __name__ == "__main__":
    recolor_report = main()
