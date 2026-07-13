#!/usr/bin/env python3
"""Verify the bundled 3DGS transition template and sample assets."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "transition-template"

REQUIRED = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "transition-dust-demo.html",
    "src/transition-dust-demo.ts",
    "src/audio/audio.ts",
    "src/demo/transitionConfig.ts",
    "src/demo/splatTransitionPair.ts",
    "src/demo/transitionDustField.ts",
    "tests/transition-dust-demo-contract.mjs",
    "public/scenes/outgoing.spz",
    "public/scenes/incoming.spz",
    "public/scenes/SCENE-ASSETS-LICENSE.txt",
    "public/audio/cipher-kevin-macleod.ogg",
    "public/audio/Cipher-LICENSE.txt",
]


def main() -> None:
    missing = [relative for relative in REQUIRED if not (TEMPLATE / relative).is_file()]
    if missing:
        raise SystemExit("Missing template files:\n" + "\n".join(f"- {item}" for item in missing))

    minimum_sizes = {
        "public/scenes/outgoing.spz": 1_000_000,
        "public/scenes/incoming.spz": 1_000_000,
        "public/audio/cipher-kevin-macleod.ogg": 1_000_000,
    }
    undersized = [
        relative
        for relative, minimum in minimum_sizes.items()
        if (TEMPLATE / relative).stat().st_size < minimum
    ]
    if undersized:
        raise SystemExit("Template assets appear truncated:\n" + "\n".join(f"- {item}" for item in undersized))

    config = (TEMPLATE / "src/demo/transitionConfig.ts").read_text(encoding="utf-8")
    for token in ["OUTGOING_SCENE", "INCOMING_SCENE", "position", "rotationDeg", "scale", "accent", "wind"]:
        if token not in config:
            raise SystemExit(f"transitionConfig.ts is missing parameterization token: {token}")

    skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    if "TODO" in skill:
        raise SystemExit("SKILL.md still contains TODO placeholders")

    scaffold_path = ROOT / "scripts" / "scaffold_transition.py"
    compile(scaffold_path.read_text(encoding="utf-8"), str(scaffold_path), "exec")
    print("3DGS transition skill template is complete")


if __name__ == "__main__":
    main()
