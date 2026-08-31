"""Render repeatable studio views of the W14/W15-livery validation asset.

This script is intentionally non-destructive: it only adds temporary camera,
light, and floor objects to the in-memory scene and never saves the .blend.
Set W14_RENDER_OUTPUT_DIR to choose where PNG evidence is written.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


PREFIX = "LiveryValidation_"
REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT_DIR = Path(
    os.environ.get(
        "W14_RENDER_OUTPUT_DIR",
        REPO_ROOT / "tmp/mercedes-2024-livery/baseline",
    )
)


def remove_previous_validation_objects() -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(PREFIX):
            bpy.data.objects.remove(obj, do_unlink=True)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_material(name: str, color: tuple[float, float, float, float], roughness: float):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    principled = next(
        node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"
    )
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    return material


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    target: Vector,
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> None:
    data = bpy.data.lights.new(PREFIX + name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(PREFIX + name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)


def setup_scene() -> tuple[bpy.types.Object, Vector]:
    remove_previous_validation_objects()

    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue

    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False

    scene.view_settings.view_transform = "AgX"
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "None"):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    world = scene.world or bpy.data.worlds.new(PREFIX + "World")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.035, 0.045, 0.055, 1.0)
    background.inputs["Strength"].default_value = 0.32

    bpy.ops.mesh.primitive_plane_add(size=30.0, location=(0.0, -0.3, -0.012))
    floor = bpy.context.object
    floor.name = PREFIX + "Floor"
    floor.data.materials.append(
        create_material(PREFIX + "FloorMaterial", (0.055, 0.065, 0.075, 1.0), 0.68)
    )

    target = Vector((0.0, -0.35, 0.48))
    add_area_light("Key", (-4.8, -4.2, 6.2), target, 1450.0, 5.0, (0.92, 0.97, 1.0))
    add_area_light("Fill", (4.5, -1.0, 3.4), target, 900.0, 4.0, (0.72, 0.84, 1.0))
    add_area_light("Rim", (0.2, 4.8, 5.5), target, 1250.0, 3.5, (0.88, 0.96, 1.0))
    add_area_light("Front", (0.0, -6.0, 2.2), target, 620.0, 3.0, (1.0, 0.91, 0.82))

    camera_data = bpy.data.cameras.new(PREFIX + "Camera")
    camera = bpy.data.objects.new(PREFIX + "Camera", camera_data)
    scene.collection.objects.link(camera)
    camera_data.lens = 56.0
    camera_data.sensor_width = 36.0
    camera_data.dof.use_dof = False
    scene.camera = camera
    return camera, target


def render_view(
    camera: bpy.types.Object,
    target: Vector,
    filename: str,
    location: tuple[float, float, float],
    lens: float,
) -> str:
    camera.location = location
    camera.data.lens = lens
    look_at(camera, target)
    path = OUTPUT_DIR / filename
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return str(path)


def main() -> list[str]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    camera, target = setup_scene()
    return [
        render_view(camera, target, "front-three-quarter.png", (4.65, -7.55, 3.05), 58.0),
        render_view(camera, target, "left-side.png", (-7.8, -0.32, 2.18), 66.0),
        render_view(camera, target, "right-side.png", (7.8, -0.32, 2.18), 66.0),
        render_view(camera, Vector((0.0, -0.38, 0.22)), "top-front.png", (0.0, -5.9, 7.7), 62.0),
        render_view(camera, Vector((0.0, -0.15, 0.52)), "rear-three-quarter.png", (-4.5, 6.5, 2.8), 58.0),
    ]


if __name__ == "__main__":
    rendered_paths = main()
