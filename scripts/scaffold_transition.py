#!/usr/bin/env python3
"""Create a standalone 3DGS transition demo from the bundled template."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = SKILL_ROOT / "assets" / "transition-template"


def triple(values: list[float], label: str) -> tuple[float, float, float]:
    if len(values) != 3:
        raise ValueError(f"{label} requires exactly three values")
    return values[0], values[1], values[2]


def format_number(value: float) -> str:
    return f"{value:.6g}"


def format_triple(values: tuple[float, float, float]) -> str:
    return ", ".join(format_number(value) for value in values)


def write_config(
    output: Path,
    outgoing_name: str,
    incoming_name: str,
    args: argparse.Namespace,
) -> None:
    outgoing_position = triple(args.outgoing_position, "--outgoing-position")
    incoming_position = triple(args.incoming_position, "--incoming-position")
    outgoing_rotation = triple(args.outgoing_rotation, "--outgoing-rotation")
    incoming_rotation = triple(args.incoming_rotation, "--incoming-rotation")
    outgoing_wind = triple(args.outgoing_wind, "--outgoing-wind")
    incoming_wind = triple(args.incoming_wind, "--incoming-wind")
    content = f'''export interface TransitionSceneSpec {{
  url: string;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: number;
  accent: string;
  wind: [number, number, number];
}}

export const OUTGOING_SCENE: TransitionSceneSpec = {{
  url: "/scenes/{outgoing_name}",
  position: [{format_triple(outgoing_position)}],
  rotationDeg: [{format_triple(outgoing_rotation)}],
  scale: {format_number(args.outgoing_scale)},
  accent: "{args.outgoing_accent}",
  wind: [{format_triple(outgoing_wind)}]
}};

export const INCOMING_SCENE: TransitionSceneSpec = {{
  url: "/scenes/{incoming_name}",
  position: [{format_triple(incoming_position)}],
  rotationDeg: [{format_triple(incoming_rotation)}],
  scale: {format_number(args.incoming_scale)},
  accent: "{args.incoming_accent}",
  wind: [{format_triple(incoming_wind)}]
}};
'''
    (output / "src" / "demo" / "transitionConfig.ts").write_text(content, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New demo directory; must not already exist")
    parser.add_argument("--outgoing", type=Path, help="Outgoing 3DGS asset")
    parser.add_argument("--incoming", type=Path, help="Incoming 3DGS asset")
    parser.add_argument("--outgoing-position", type=float, nargs=3, default=[0, 1.35, -1.2])
    parser.add_argument("--incoming-position", type=float, nargs=3, default=[0, 1.2, -2.8])
    parser.add_argument("--outgoing-rotation", type=float, nargs=3, default=[180, 0, 0])
    parser.add_argument("--incoming-rotation", type=float, nargs=3, default=[180, 0, 0])
    parser.add_argument("--outgoing-scale", type=float, default=1.8)
    parser.add_argument("--incoming-scale", type=float, default=1.0)
    parser.add_argument("--outgoing-accent", default="#f2a66d")
    parser.add_argument("--incoming-accent", default="#74d7ff")
    parser.add_argument("--outgoing-wind", type=float, nargs=3, default=[-0.9, 0.18, 0.06])
    parser.add_argument("--incoming-wind", type=float, nargs=3, default=[0.9, 0.2, -0.06])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise SystemExit(f"Refusing to overwrite existing path: {output}")
    if (args.outgoing is None) != (args.incoming is None):
        raise SystemExit("Provide both --outgoing and --incoming, or neither to keep the bundled sample scenes")

    shutil.copytree(
        TEMPLATE_ROOT,
        output,
        ignore=shutil.ignore_patterns("node_modules", "dist", "output", ".playwright"),
    )
    if args.outgoing is not None and args.incoming is not None:
        outgoing = args.outgoing.expanduser().resolve()
        incoming = args.incoming.expanduser().resolve()
        if not outgoing.is_file() or not incoming.is_file():
            shutil.rmtree(output)
            raise SystemExit("Both scene arguments must be readable files")
        scene_dir = output / "public" / "scenes"
        shutil.rmtree(scene_dir)
        scene_dir.mkdir(parents=True)
        outgoing_name = f"outgoing{''.join(outgoing.suffixes)}"
        incoming_name = f"incoming{''.join(incoming.suffixes)}"
        shutil.copy2(outgoing, scene_dir / outgoing_name)
        shutil.copy2(incoming, scene_dir / incoming_name)
        write_config(output, outgoing_name, incoming_name, args)

    print(f"Created 3DGS transition demo: {output}")
    print(f"Next: cd {output} && npm ci && npm run build && npm test")


if __name__ == "__main__":
    main()
