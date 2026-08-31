"""Build the fine-grained Montréal runtime GLB from an isolated working copy.

Keep this beside ``enhance_montreal_track.py`` so the helper import stays local.

The material pass and preserved source mesh come from
``montreal-track-working.blend``. This script creates a new 250 m tile
collection without touching the existing 900 m collection, verifies the exact
surface signature, and exports only the new tiles.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys


DEFAULT_TILE_SIZE_METERS = 250.0
DEFAULT_COLLECTION = "Montreal_Track_Runtime_Tiles_v2"
DEFAULT_PASS_VERSION = "2026-08-30-option-b-v1"


def _arguments() -> argparse.Namespace:
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--tile-size", type=float, default=DEFAULT_TILE_SIZE_METERS)
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--pass-version", default=DEFAULT_PASS_VERSION)
    return parser.parse_args(script_args)


def _load_enhancement_module():
    module_path = Path(__file__).with_name("enhance_montreal_track.py")
    spec = importlib.util.spec_from_file_location("theonboard_track_enhancer", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    args = _arguments()
    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    enhancer = _load_enhancement_module()
    enhancer.PASS_VERSION = args.pass_version
    enhancer.TILE_COLLECTION_NAME = args.collection
    enhancer.TILE_SIZE_METERS = args.tile_size

    tiling = enhancer.partition_track(args.tile_size)
    if not tiling.get("surface_signature_matches"):
        raise RuntimeError(
            "Runtime tiling changed track positions, UVs, materials, or face topology"
        )
    export = enhancer.export_enhanced_glb(output_path)
    if export["triangle_count"] != tiling["triangle_count"]:
        raise RuntimeError("Exported triangle count does not match verified tiling")

    print(
        "THEONBOARD_TRACK_RUNTIME_RESULT="
        + json.dumps(
            {
                "tile_size_meters": args.tile_size,
                "tiling": tiling,
                "export": export,
            },
            sort_keys=True,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
