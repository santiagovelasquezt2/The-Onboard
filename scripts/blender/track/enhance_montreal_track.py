"""Non-destructive Blender pass for TheOnboard's Montreal track asset.

Run this inside the Blender scene produced by importing ``montreal.glb``.
The original ``montreal`` object and source images are retained as recoverable
datablocks. Generated geometry and textures use versioned names so the pass can
be inspected before export.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import gc
import hashlib
import math
import os
import struct
import time

import bpy
import numpy as np


PASS_VERSION = "2026-08-29-v1"
SOURCE_OBJECT_NAME = "montreal"
TILE_COLLECTION_NAME = "Montreal_Track_Tiles_v1"
TILE_SIZE_METERS = 900.0
ENHANCED_GLB_NAME = "montreal-enhanced.glb"
MAX_NORMAL_TEXTURE_SIZE = 1024


def _track_asset_dir() -> str:
    """Resolve alongside the saved working blend instead of a machine path."""

    if not bpy.data.filepath:
        raise RuntimeError("Save the working .blend before running the track pass")
    return os.path.dirname(bpy.data.filepath)


def _source_object() -> bpy.types.Object:
    obj = bpy.data.objects.get(SOURCE_OBJECT_NAME)
    if obj is None or obj.type != "MESH":
        raise RuntimeError(f"Expected mesh object {SOURCE_OBJECT_NAME!r}")
    return obj


def _principled(material: bpy.types.Material) -> bpy.types.Node:
    if not material.use_nodes or material.node_tree is None:
        material.use_nodes = True
    node = next(
        (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if node is None:
        raise RuntimeError(f"Material {material.name!r} has no Principled BSDF")
    return node


def _base_color_texture(material: bpy.types.Material) -> bpy.types.Node:
    principled = _principled(material)
    base_color = principled.inputs.get("Base Color")
    if base_color is not None and base_color.is_linked:
        node = base_color.links[0].from_node
        if node.type == "TEX_IMAGE":
            return node
    node = next(
        (node for node in material.node_tree.nodes if node.type == "TEX_IMAGE"),
        None,
    )
    if node is None:
        raise RuntimeError(f"Material {material.name!r} has no image texture")
    return node


def _pixels(image: bpy.types.Image) -> np.ndarray:
    values = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(values)
    return values.reshape((image.size[1], image.size[0], 4))


def _generated_image(
    name: str,
    width: int,
    height: int,
    colorspace: str,
) -> bpy.types.Image:
    image = bpy.data.images.get(name)
    if image is not None and tuple(image.size) != (width, height):
        image.name = f"{image.name}__stale"
        image = None
    if image is None:
        image = bpy.data.images.new(
            name,
            width=width,
            height=height,
            alpha=True,
            float_buffer=False,
        )
    image.colorspace_settings.name = colorspace
    return image


def _save_generated_image(image: bpy.types.Image, filename: str) -> str:
    derived_texture_dir = os.path.join(_track_asset_dir(), "derived")
    os.makedirs(derived_texture_dir, exist_ok=True)
    path = os.path.join(derived_texture_dir, filename)
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    image.pack()
    return path


def _alpha_bleed(rgb: np.ndarray, alpha: np.ndarray, iterations: int) -> np.ndarray:
    """Bleed edge colors into transparent texels without changing alpha."""

    if iterations <= 0:
        return rgb
    output = rgb.copy()
    confidence = alpha.copy()
    immutable = alpha >= 0.05
    for _ in range(iterations):
        next_rgb = output.copy()
        next_confidence = confidence.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            source_confidence = np.roll(confidence, (dy, dx), axis=(0, 1))
            source_rgb = np.roll(output, (dy, dx), axis=(0, 1))
            mask = (~immutable) & (source_confidence > next_confidence)
            next_confidence[mask] = source_confidence[mask]
            next_rgb[mask] = source_rgb[mask]
        output = next_rgb
        confidence = next_confidence
    return output


def _grade_image(
    source: bpy.types.Image,
    suffix: str,
    rgb_multiplier: tuple[float, float, float],
    saturation: float,
    bleed_iterations: int = 0,
) -> tuple[bpy.types.Image, str]:
    values = _pixels(source)
    rgb = values[:, :, :3]
    alpha = values[:, :, 3]
    luminance = (
        rgb[:, :, 0] * 0.2126
        + rgb[:, :, 1] * 0.7152
        + rgb[:, :, 2] * 0.0722
    )[:, :, None]
    rgb = luminance + (rgb - luminance) * saturation
    rgb *= np.asarray(rgb_multiplier, dtype=np.float32)[None, None, :]
    rgb = np.clip(rgb, 0.0, 1.0)
    rgb = _alpha_bleed(rgb, alpha, bleed_iterations)

    name = f"{source.name}__TO_{suffix}_{PASS_VERSION}"
    output = _generated_image(name, source.size[0], source.size[1], "sRGB")
    packed = np.empty_like(values)
    packed[:, :, :3] = rgb
    packed[:, :, 3] = alpha
    output.pixels.foreach_set(packed.ravel())
    output.update()
    path = _save_generated_image(output, f"{name}.png")
    del values, rgb, alpha, luminance, packed
    gc.collect()
    return output, path


def _normal_image(
    source: bpy.types.Image,
    suffix: str,
    gradient_strength: float,
    high_pass_radius: int,
) -> tuple[bpy.types.Image, str]:
    values = _pixels(source)
    rgb = values[:, :, :3]
    height = (
        rgb[:, :, 0] * 0.2126
        + rgb[:, :, 1] * 0.7152
        + rgb[:, :, 2] * 0.0722
    )
    target_width, target_height = _normal_target_size(source)
    if (target_width, target_height) != tuple(source.size):
        source_height, source_width = height.shape
        factor_x = source_width // target_width
        factor_y = source_height // target_height
        if (
            factor_x == factor_y
            and source_width % target_width == 0
            and source_height % target_height == 0
        ):
            factor = factor_x
            height = height.reshape(
                target_height,
                factor,
                target_width,
                factor,
            ).mean(axis=(1, 3))
        else:
            x_indices = np.linspace(0, source_width - 1, target_width).astype(int)
            y_indices = np.linspace(0, source_height - 1, target_height).astype(int)
            height = height[np.ix_(y_indices, x_indices)]
    radius = max(1, int(high_pass_radius))
    kernel_width = radius * 2 + 1
    horizontal = sum(
        np.roll(height, offset, axis=1)
        for offset in range(-radius, radius + 1)
    ) / kernel_width
    low_frequency = sum(
        np.roll(horizontal, offset, axis=0)
        for offset in range(-radius, radius + 1)
    ) / kernel_width
    detail = np.clip(height - low_frequency, -0.12, 0.12)
    dx = (np.roll(detail, -1, axis=1) - np.roll(detail, 1, axis=1)) * 0.5
    dy = (np.roll(detail, -1, axis=0) - np.roll(detail, 1, axis=0)) * 0.5
    nx = -dx * gradient_strength
    ny = -dy * gradient_strength
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)

    normal = np.empty((target_height, target_width, 4), dtype=values.dtype)
    normal[:, :, 0] = nx / length * 0.5 + 0.5
    normal[:, :, 1] = ny / length * 0.5 + 0.5
    normal[:, :, 2] = nz / length * 0.5 + 0.5
    normal[:, :, 3] = 1.0

    name = f"{source.name}__TO_{suffix}_{PASS_VERSION}"
    output = _generated_image(name, target_width, target_height, "Non-Color")
    output.pixels.foreach_set(np.clip(normal, 0.0, 1.0).ravel())
    output.update()
    path = _save_generated_image(output, f"{name}.png")
    del values, rgb, height, horizontal, low_frequency, detail, dx, dy
    del nx, ny, nz, length, normal
    gc.collect()
    return output, path


def _normal_target_size(source: bpy.types.Image) -> tuple[int, int]:
    width, height = source.size
    if width <= MAX_NORMAL_TEXTURE_SIZE or height <= MAX_NORMAL_TEXTURE_SIZE:
        return int(width), int(height)
    divisor = max(2, math.ceil(max(width, height) / MAX_NORMAL_TEXTURE_SIZE))
    return max(1, width // divisor), max(1, height // divisor)


def _set_scalar(material_name: str, socket: str, value: float) -> None:
    material = bpy.data.materials.get(material_name)
    if material is None:
        return
    principled = _principled(material)
    target = principled.inputs.get(socket)
    if target is not None:
        target.default_value = value


def _connect_normal(
    material: bpy.types.Material,
    image: bpy.types.Image,
    strength: float,
) -> None:
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    texture = nodes.get("TheOnboard Normal Texture")
    if texture is None:
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = "TheOnboard Normal Texture"
        texture.label = "TheOnboard derived surface normal"
    texture.image = image
    texture.interpolation = "Linear"
    normal_map = nodes.get("TheOnboard Normal Map")
    if normal_map is None:
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.name = "TheOnboard Normal Map"
    normal_map.inputs["Strength"].default_value = strength
    principled = _principled(material)
    links.new(texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])


def enhance_materials() -> dict[str, object]:
    started = time.time()
    graded_specs = {
        "AsphaltMat": ((0.74, 0.73, 0.70), 0.82, 0),
        "Asphalt03Mat": ((0.76, 0.75, 0.72), 0.84, 0),
        "Asphalt02Mat": ((0.78, 0.77, 0.74), 0.84, 0),
        "KerbMat": ((0.90, 0.86, 0.83), 0.90, 0),
        "GrassMat": ((0.80, 0.84, 0.73), 0.86, 0),
        "GuardrailMat": ((0.82, 0.82, 0.84), 0.70, 0),
        "WallMat": ((0.86, 0.86, 0.84), 0.90, 0),
        "GitterMat": ((0.82, 0.82, 0.84), 0.35, 3),
        "trees_01": ((0.82, 0.84, 0.74), 0.82, 4),
        "trees_02": ((0.82, 0.84, 0.74), 0.82, 4),
        "grass_straws_01": ((0.78, 0.82, 0.70), 0.84, 4),
    }
    derived_by_material: dict[str, bpy.types.Image] = {}
    generated_paths: list[str] = []
    for material_name, (multiplier, saturation, bleed) in graded_specs.items():
        material = bpy.data.materials.get(material_name)
        if material is None:
            continue
        texture = _base_color_texture(material)
        if texture.image is None:
            continue
        source = texture.image
        if "__TO_grade_" in source.name:
            derived = source
        else:
            derived, path = _grade_image(
                source,
                "grade",
                multiplier,
                saturation,
                bleed,
            )
            generated_paths.append(path)
        texture.image = derived
        derived_by_material[material_name] = derived

    normal_specs = {
        "AsphaltMat": (13.0, 3, 0.58),
        "Asphalt03Mat": (13.0, 3, 0.56),
        "Asphalt02Mat": (11.0, 3, 0.50),
        "KerbMat": (7.0, 2, 0.42),
        "GrassMat": (9.0, 2, 0.48),
        "GuardrailMat": (8.0, 2, 0.34),
        "WallMat": (8.0, 2, 0.32),
    }
    for material_name, (gradient_strength, radius, node_strength) in normal_specs.items():
        material = bpy.data.materials.get(material_name)
        source = derived_by_material.get(material_name)
        if material is None or source is None:
            continue
        normal_name = f"{source.name}__TO_normal_{PASS_VERSION}"
        normal = bpy.data.images.get(normal_name)
        stale_normal = None
        if normal is not None and tuple(normal.size) != _normal_target_size(source):
            stale_normal = normal
            stale_normal.name = f"{stale_normal.name}__stale"
            normal = None
        if normal is None:
            normal, path = _normal_image(
                source,
                "normal",
                gradient_strength,
                radius,
            )
            generated_paths.append(path)
        _connect_normal(material, normal, node_strength)
        if stale_normal is not None and stale_normal.users == 0:
            bpy.data.images.remove(stale_normal)

    scalar_values = {
        "AsphaltMat": (0.76, 0.0, 0.24),
        "Asphalt03Mat": (0.77, 0.0, 0.24),
        "Asphalt02Mat": (0.80, 0.0, 0.22),
        "KerbMat": (0.72, 0.0, 0.28),
        "GrassMat": (0.95, 0.0, 0.04),
        "GuardrailMat": (0.46, 0.58, 0.34),
        "ZinkMat": (0.44, 0.62, 0.34),
        "GitterMat": (0.56, 0.32, 0.20),
        "WallMat": (0.84, 0.0, 0.18),
        "GravelMat": (0.92, 0.0, 0.05),
        "RunoffgreenMat": (0.74, 0.0, 0.20),
        "RunoffredMat": (0.74, 0.0, 0.20),
        "MarksMat": (0.70, 0.0, 0.24),
        "trees_01": (1.0, 0.0, 0.02),
        "trees_02": (1.0, 0.0, 0.02),
        "grass_straws_01": (1.0, 0.0, 0.02),
        "groove_01": (0.82, 0.0, 0.08),
    }
    for name, (roughness, metallic, specular) in scalar_values.items():
        _set_scalar(name, "Roughness", roughness)
        _set_scalar(name, "Metallic", metallic)
        _set_scalar(name, "Specular IOR Level", specular)

    cutout_names = ("GitterMat", "trees_01", "trees_02", "grass_straws_01")
    for name in cutout_names:
        material = bpy.data.materials.get(name)
        if material is None:
            continue
        texture = _base_color_texture(material)
        principled = _principled(material)
        material.node_tree.links.new(texture.outputs["Alpha"], principled.inputs["Alpha"])
        material.use_backface_culling = False
        material.surface_render_method = "DITHERED"
        if hasattr(material, "alpha_threshold"):
            material.alpha_threshold = 0.35
        try:
            material.blend_method = "CLIP"
        except Exception:
            pass

    groove = bpy.data.materials.get("groove_01")
    if groove is not None:
        texture = _base_color_texture(groove)
        principled = _principled(groove)
        groove.node_tree.links.new(texture.outputs["Alpha"], principled.inputs["Alpha"])
        groove.surface_render_method = "BLENDED"
        try:
            groove.blend_method = "BLEND"
        except Exception:
            pass

    for material in bpy.data.materials:
        material["theonboard_track_pass"] = PASS_VERSION

    bpy.context.scene["theonboard_material_pass"] = PASS_VERSION
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)
    return {
        "materials_enhanced": len(graded_specs),
        "normal_mapped_materials": len(normal_specs),
        "generated_paths": generated_paths,
        "elapsed_seconds": round(time.time() - started, 2),
    }


def _triangle_signature(
    objects: list[bpy.types.Object],
    include_normals: bool = True,
) -> str:
    triangle_digests: list[bytes] = []
    for obj in objects:
        mesh = obj.data
        uv_layer = mesh.uv_layers.active
        if uv_layer is None:
            raise RuntimeError(f"Mesh {mesh.name!r} is missing its UV layer")
        uv_data = uv_layer.data
        corner_normals = mesh.corner_normals
        for polygon in mesh.polygons:
            digest = hashlib.sha256()
            material = obj.material_slots[polygon.material_index].material
            material_name = material.name.encode("utf-8")
            digest.update(struct.pack("<I", len(material_name)))
            digest.update(material_name)
            digest.update(struct.pack("<B", 1 if polygon.use_smooth else 0))
            for loop_index in polygon.loop_indices:
                vertex_index = mesh.loops[loop_index].vertex_index
                coordinate = mesh.vertices[vertex_index].co
                uv = uv_data[loop_index].uv
                digest.update(
                    struct.pack(
                        "<5f",
                        coordinate.x,
                        coordinate.y,
                        coordinate.z,
                        uv.x,
                        uv.y,
                    )
                )
                if include_normals:
                    normal = corner_normals[loop_index].vector
                    digest.update(struct.pack("<3f", normal.x, normal.y, normal.z))
            triangle_digests.append(digest.digest())
    triangle_digests.sort()
    output = hashlib.sha256()
    for digest in triangle_digests:
        output.update(digest)
    return output.hexdigest()


def _restore_decoded_custom_normals(
    source: bpy.types.Object,
    tiles: list[bpy.types.Object],
    tile_size: float,
) -> None:
    """Reapply decoded normals after tiling.

    Blender's packed custom-normal representation is topology-relative, so raw
    INT16 values cannot be copied across split vertices. Re-encoding decoded
    vectors keeps the maximum deviation below one tenth of a degree.
    """

    min_x = min(corner[0] for corner in source.bound_box)
    min_z = min(corner[2] for corner in source.bound_box)
    grouped_polygons: dict[tuple[int, int], list[int]] = defaultdict(list)
    for polygon in source.data.polygons:
        cell = (
            math.floor((polygon.center.x - min_x) / tile_size),
            math.floor((polygon.center.z - min_z) / tile_size),
        )
        grouped_polygons[cell].append(polygon.index)

    tile_by_name = {tile.name: tile for tile in tiles}
    tile_by_cell = {}
    for tile in tiles:
        stored_cell = tile.get("theonboard_tile_cell")
        if stored_cell is not None:
            tile_by_cell[tuple(int(value) for value in stored_cell)] = tile
    for cell, polygon_indices in grouped_polygons.items():
        name = f"montreal_tile_{cell[0]:02d}_{cell[1]:02d}"
        tile = tile_by_cell.get(cell) or tile_by_name.get(name)
        if tile is None:
            raise RuntimeError(f"Missing generated tile for cell {cell}")
        normals = [
            tuple(source.data.corner_normals[loop_index].vector)
            for polygon_index in polygon_indices
            for loop_index in source.data.polygons[polygon_index].loop_indices
        ]
        tile.data.normals_split_custom_set(normals)
        tile.data.update()


def partition_track(tile_size: float = TILE_SIZE_METERS) -> dict[str, object]:
    started = time.time()
    source = _source_object()
    scene = bpy.context.scene
    existing = bpy.data.collections.get(TILE_COLLECTION_NAME)
    if existing is not None and any(obj.type == "MESH" for obj in existing.objects):
        tiles = [obj for obj in existing.objects if obj.type == "MESH"]
        _restore_decoded_custom_normals(source, tiles, tile_size)
        signature = _triangle_signature(tiles)
        surface_signature = _triangle_signature(tiles, include_normals=False)
        expected_surface_signature = _triangle_signature(
            [source], include_normals=False
        )
        expected_signature = scene.get("baseline_geometry_signature")
        scene["tiled_geometry_signature"] = signature
        scene["tiled_geometry_matches_baseline"] = bool(
            expected_signature == signature
        )
        scene["tiled_surface_signature"] = surface_signature
        scene["source_surface_signature"] = expected_surface_signature
        scene["tiled_surface_matches_source"] = bool(
            surface_signature == expected_surface_signature
        )
        bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)
        return {
            "reused": True,
            "tile_count": len(tiles),
            "triangle_count": sum(len(obj.data.polygons) for obj in tiles),
            "signature": signature,
            "expected_signature": expected_signature,
            "normal_signature_matches": expected_signature == signature,
            "surface_signature": surface_signature,
            "expected_surface_signature": expected_surface_signature,
            "surface_signature_matches": surface_signature
            == expected_surface_signature,
        }

    collection = existing or bpy.data.collections.new(TILE_COLLECTION_NAME)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)

    mesh = source.data
    uv_data = mesh.uv_layers.active.data
    source_corner_normals = mesh.corner_normals
    min_x = min(corner[0] for corner in source.bound_box)
    min_z = min(corner[2] for corner in source.bound_box)
    groups: dict[tuple[int, int], list[int]] = defaultdict(list)
    for polygon in mesh.polygons:
        cell = (
            math.floor((polygon.center.x - min_x) / tile_size),
            math.floor((polygon.center.z - min_z) / tile_size),
        )
        groups[cell].append(polygon.index)

    created: list[bpy.types.Object] = []
    for cell, polygon_indices in sorted(groups.items()):
        vertex_map: dict[int, int] = {}
        vertices: list[tuple[float, float, float]] = []
        faces: list[list[int]] = []
        uvs: list[tuple[float, float]] = []
        normals: list[tuple[float, float, float]] = []
        smooth_flags: list[bool] = []
        source_material_indices: list[int] = []
        used_material_indices = sorted(
            {mesh.polygons[index].material_index for index in polygon_indices}
        )
        material_remap = {
            source_index: output_index
            for output_index, source_index in enumerate(used_material_indices)
        }

        for polygon_index in polygon_indices:
            polygon = mesh.polygons[polygon_index]
            face: list[int] = []
            for loop_index in polygon.loop_indices:
                source_vertex_index = mesh.loops[loop_index].vertex_index
                output_vertex_index = vertex_map.get(source_vertex_index)
                if output_vertex_index is None:
                    output_vertex_index = len(vertices)
                    vertex_map[source_vertex_index] = output_vertex_index
                    coordinate = mesh.vertices[source_vertex_index].co
                    vertices.append(tuple(coordinate))
                face.append(output_vertex_index)
                uvs.append(tuple(uv_data[loop_index].uv))
                normals.append(tuple(source_corner_normals[loop_index].vector))
            faces.append(face)
            smooth_flags.append(polygon.use_smooth)
            source_material_indices.append(polygon.material_index)

        mesh_name = f"montreal_tile_{cell[0]:02d}_{cell[1]:02d}"
        tile_mesh = bpy.data.meshes.new(mesh_name)
        tile_mesh.from_pydata(vertices, [], faces)
        tile_mesh.update(calc_edges=True)
        tile_uv = tile_mesh.uv_layers.new(name=mesh.uv_layers.active.name)
        for loop_index, uv in enumerate(uvs):
            tile_uv.data[loop_index].uv = uv
        for source_material_index in used_material_indices:
            tile_mesh.materials.append(source.material_slots[source_material_index].material)
        for index, polygon in enumerate(tile_mesh.polygons):
            polygon.material_index = material_remap[source_material_indices[index]]
            polygon.use_smooth = smooth_flags[index]
        tile_mesh.normals_split_custom_set(normals)
        tile_mesh.update()

        tile_object = bpy.data.objects.new(mesh_name, tile_mesh)
        collection.objects.link(tile_object)
        tile_object["theonboard_track_pass"] = PASS_VERSION
        tile_object["theonboard_tile_cell"] = cell
        tile_object["theonboard_tile_size_meters"] = tile_size
        created.append(tile_object)

    _restore_decoded_custom_normals(source, created, tile_size)
    source.hide_render = True
    source.hide_viewport = True
    source["theonboard_preserved_source"] = True
    scene["theonboard_tile_collection"] = TILE_COLLECTION_NAME
    scene["theonboard_tile_size_meters"] = tile_size
    scene["theonboard_track_pass"] = PASS_VERSION
    bpy.context.view_layer.update()

    triangle_count = sum(len(obj.data.polygons) for obj in created)
    material_face_counts: Counter[str] = Counter()
    for obj in created:
        for polygon in obj.data.polygons:
            material = obj.material_slots[polygon.material_index].material
            material_face_counts[material.name] += 1
    signature = _triangle_signature(created)
    surface_signature = _triangle_signature(created, include_normals=False)
    expected_surface_signature = _triangle_signature(
        [source], include_normals=False
    )
    expected = scene.get("baseline_geometry_signature")
    scene["tiled_geometry_signature"] = signature
    scene["tiled_geometry_matches_baseline"] = bool(expected == signature)
    scene["tiled_surface_signature"] = surface_signature
    scene["source_surface_signature"] = expected_surface_signature
    scene["tiled_surface_matches_source"] = bool(
        surface_signature == expected_surface_signature
    )
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)
    return {
        "reused": False,
        "tile_size_meters": tile_size,
        "tile_count": len(created),
        "triangle_count": triangle_count,
        "vertex_count": sum(len(obj.data.vertices) for obj in created),
        "signature": signature,
        "expected_signature": expected,
        "signature_matches": expected == signature,
        "surface_signature": surface_signature,
        "expected_surface_signature": expected_surface_signature,
        "surface_signature_matches": surface_signature
        == expected_surface_signature,
        "material_face_counts": dict(material_face_counts),
        "elapsed_seconds": round(time.time() - started, 2),
    }


def export_enhanced_glb(output_path: str | None = None) -> dict[str, object]:
    """Export only the enhanced tiles while preserving native app coordinates."""

    collection = bpy.data.collections.get(TILE_COLLECTION_NAME)
    if collection is None:
        raise RuntimeError("Run the tiling stage before export")
    tiles = sorted(
        (obj for obj in collection.objects if obj.type == "MESH"),
        key=lambda obj: obj.name,
    )
    if not tiles:
        raise RuntimeError("The enhanced tile collection contains no meshes")

    output_path = output_path or os.path.join(
        _track_asset_dir(), ENHANCED_GLB_NAME
    )
    previous_selected = list(bpy.context.selected_objects)
    previous_active = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action="DESELECT")
    for tile in tiles:
        tile.select_set(True)
    bpy.context.view_layer.objects.active = tiles[0]

    scene = bpy.context.scene
    private_scene_metadata = {
        key: scene[key]
        for key in scene.keys()
        if isinstance(scene[key], str) and os.path.isabs(scene[key])
    }
    for key in private_scene_metadata:
        del scene[key]

    started = time.time()
    try:
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format="GLB",
            use_selection=True,
            use_active_scene=True,
            export_yup=False,
            export_materials="EXPORT",
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_extras=True,
            export_cameras=False,
            export_lights=False,
            export_animations=False,
        )
    finally:
        for key, value in private_scene_metadata.items():
            scene[key] = value
        bpy.ops.object.select_all(action="DESELECT")
        for obj in previous_selected:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if previous_active and previous_active.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = previous_active

    return {
        "path": output_path,
        "bytes": os.path.getsize(output_path),
        "tile_count": len(tiles),
        "triangle_count": sum(len(obj.data.polygons) for obj in tiles),
        "elapsed_seconds": round(time.time() - started, 2),
    }


def run(stage: str = "all") -> dict[str, object]:
    output: dict[str, object] = {"stage": stage, "pass_version": PASS_VERSION}
    if stage in {"tile", "all"}:
        output["tiling"] = partition_track()
    if stage in {"materials", "all"}:
        output["materials"] = enhance_materials()
    if stage in {"export", "all"}:
        output["export"] = export_enhanced_glb()
    return output
