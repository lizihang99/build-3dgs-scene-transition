---
name: build-3dgs-scene-transition
description: Build, reproduce, adapt, and visually verify a GSplat-native transition between two 3D Gaussian Splatting scenes. Use when Codex must transition between .splat, .spz, .ply, or other renderer-supported 3DGS assets; reproduce the bundled outgoing-scene to spectral-filament to incoming-scene effect; replace the sample scenes with other 3DGS captures; add two-step controls; or make the transition react to FFT audio while preserving Gaussian-splat visual continuity.
---

# Build 3DGS Scene Transition

Create a working transition between two 3DGS scenes using the bundled Spark/Three.js reference implementation. Preserve the visual contract instead of reducing the effect to a generic point-particle dissolve.

## Start Here

1. Inspect the target repository, 3DGS renderer/version, scene loading code, camera transforms, audio engine, and existing UI conventions.
2. Read [references/effect-contract.md](references/effect-contract.md) before changing motion, rendering, timing, controls, color, or audio behavior.
3. Read [references/adaptation.md](references/adaptation.md) before replacing either scene asset or integrating into a non-template project.
4. Use `assets/transition-template/` as the canonical runnable implementation.
5. Create a standalone adaptation first unless the user explicitly requests immediate integration into the main application.

## Choose the Delivery Path

### Reproduce the current effect exactly

Copy `assets/transition-template/` to a new directory. Keep its sample scenes and licensed music. Install dependencies, build, run the contract test, then perform the browser checks in [references/verification.md](references/verification.md).

### Replace the two 3DGS scenes

Run:

```bash
python3 scripts/scaffold_transition.py \
  --output /absolute/path/to/new-demo \
  --outgoing /absolute/path/to/old-scene.spz \
  --incoming /absolute/path/to/new-scene.splat
```

Then edit `src/demo/transitionConfig.ts` to calibrate each scene's position, rotation, scale, accent, and wind. Do not treat the default transforms as portable.

### Integrate into an existing application

Reuse the target repository's Three.js renderer, animation loop, audio context, controls, motion tokens, and UI patterns. Port these ownership units rather than copying the whole page:

- `TransitionDustField`: proxy GSplat bridge, spectral filaments, Curl Flow, FFT uniforms.
- `SplatTransitionPair`: two preloaded scene buffers, one stable scene mesh, and release/incoming reveal modifiers.
- Flow state machine: `STANDBY`, `LOADING`, `READY`, `ENTERED`.
- Audio mapping: reuse the existing audio analyser when one exists; do not create competing audio contexts.

For Spark or Three.js API differences, adapt the renderer-facing layer and preserve the behavioral contract. Do not downgrade to `THREE.Points` merely because the current modifier API changed.

## Required Workflow

1. Load and frame both scenes independently.
2. Record stable scene transforms in `transitionConfig.ts` or the target project's equivalent configuration.
3. Confirm the outgoing and incoming scenes render independently before enabling transition modifiers.
4. Preload both assets into separate `PackedSplats` sources, but keep one persistent scene `SplatMesh` in the scene tree. Simultaneous dynamic scene meshes can corrupt Spark 2.1.x accumulator mappings.
5. Implement three visual phases:
   - Release: dissolve the outgoing 3DGS and move it along a directional field.
   - Hold: hide the persistent scene mesh and render the proxy GSplat spectral-filament field.
   - Incoming reveal: switch the same mesh to the incoming source, transform, and reveal modifier; then reveal it while fading the proxy field.
6. On each source swap, set both `mesh.splats` and `mesh.packedSplats`, replace the modifier, then call `updateGenerator()` and `updateMappingVersion()` before revealing the mesh.
7. Default the incoming reveal to `center-bloom`: during Enter, keep roughly the first 44% as proxy GSplat forward surge only, then reveal the real incoming splats from the robust center outward.
8. Keep the classic `gather` reveal mode available as a switchable alternative when adapting the template.
9. Keep the hold state alive until the second action; do not auto-advance it unless requested.
10. Wire optional FFT response using [references/motion-audio.md](references/motion-audio.md).
11. Expose a debug state contract comparable to `window.__transitionDustDemo` for deterministic verification.
12. Run all checks in [references/verification.md](references/verification.md).

## Non-Negotiable Quality Rules

- Use Gaussian splats for the transition field when the surrounding scenes are Gaussian splats.
- Do not require one-to-one splat correspondence unless the user explicitly requests exact morphing and both buffers are accessible.
- Do not use a white flash or overexposure pulse to hide coordinate discontinuities.
- The default center reveal must act on the real incoming 3DGS splats, not a second generic particle system.
- Keep motion coherent and fluid. FFT changes amplitudes and field parameters; it must not directly jitter particle coordinates.
- Drive transition duration from elapsed wall-clock time so low frame rates do not lengthen the sequence.
- Disable frustum culling for GPU-modified proxy splats whose generated positions exceed source bounds.
- Keep UI and visual effects responsive on desktop and mobile.
- Preserve attribution for bundled or substituted licensed audio.

## Bundled Resources

- `assets/transition-template/`: complete runnable reproduction with two sample 3DGS scenes, GSplat bridge, audio, controls, and tests.
- `scripts/scaffold_transition.py`: safely create a new standalone adaptation and substitute scene files.
- `scripts/verify_template.py`: verify required source, sample assets, license, and parameterization points.
- [references/effect-contract.md](references/effect-contract.md): exact visual and interaction behavior.
- [references/adaptation.md](references/adaptation.md): scene replacement and renderer-version guidance.
- [references/motion-audio.md](references/motion-audio.md): motion field and FFT mapping.
- [references/verification.md](references/verification.md): build, browser, audio, and visual acceptance checks.
