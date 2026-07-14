# Adapting Other 3DGS Scenes

## Supported Shape

The bundled implementation targets Three.js with `@sparkjsdev/spark` 2.1.x. Scene files may use any format supported by the installed `SplatMesh` loader. Confirm support instead of assuming every `.ply` or compressed variant is compatible.

## Scene Configuration

Configure each scene in `src/demo/transitionConfig.ts`:

- `url`: public URL of the scene asset.
- `position`: world-space placement.
- `rotationDeg`: source capture orientation correction.
- `scale`: normalization into the transition camera.
- `accent`: representative transition tint.
- `wind`: outgoing/incoming dissolve direction.

## Calibration Sequence

1. Disable the proxy field and transition modifiers.
2. Render the outgoing scene alone.
3. Correct source orientation first, then scale, then position.
4. Frame the camera so the subject is readable without clipping.
5. Repeat independently for the incoming scene.
6. Verify both scenes use the same camera contract or define explicit camera interpolation.
7. Enable release and incoming reveal modifiers at progress 0 and 1 and confirm neither creates NaNs, clipping, or reversed opacity.
8. Tune wind projection for the subject's composition; do not reuse left/right directions blindly.

Different captures frequently use inverted Y, a 180-degree X correction, different unit scales, and widely different centers. No robust generic transform can be inferred from the filename alone.

## Incoming Reveal Modes

The template exposes two incoming reveal modes:

- `center-bloom`: default. The proxy GSplat bridge surges forward first, then the real incoming splats expand from a sampled robust center toward their original positions.
- `gather`: compatibility mode. The real incoming splats fade back from a wind-dispersed modifier state.

For `center-bloom`, the implementation samples the incoming `PackedSplats` centers after load and estimates a 1%-99% center and half-extent. This keeps a few outlier splats from making the reveal order feel wrong. Scene transforms still must be calibrated separately in `transitionConfig.ts`; the sampled bounds describe the asset's local splat space, not the final camera framing.

## Transition Strategy

Use the default proxy bridge when:

- splat counts differ substantially;
- source topology is unrelated;
- the renderer does not expose stable CPU splat buffers;
- the outgoing scene has already moved out before the incoming scene is ready.

Consider direct per-splat morphing only when both buffers are accessible, coordinate spaces are normalized, and a correspondence strategy is explicitly required. Direct morphing is not necessary for visual continuity.

## Renderer Version Changes

Inspect the installed renderer before porting:

- `SplatMesh` construction and load callback semantics;
- editable/generated splat APIs;
- object modifier or shader injection APIs;
- dynamic uniform primitives;
- mesh update invalidation and disposal;
- sorting, culling, and renderer registration.

For Spark 2.1.x, preload unrelated scenes into separate `PackedSplats` sources and reuse one scene `SplatMesh`. When switching, update both `mesh.splats` and `mesh.packedSplats`, replace the modifier and scene transform, then call `updateGenerator()` and `updateMappingVersion()`. Keep both sources alive for Replay. `SplatMesh.dispose()` owns only the currently attached source, so dispose the inactive source separately during teardown.

If Spark's `dyno` API differs, port `TransitionDustField` and `attachTransitionModifier` to the version's supported modifier surface. Preserve the phase/state/audio contracts and Gaussian primitive. Do not silently substitute a point cloud.

## Existing Application Integration

- Reuse an existing `WebGLRenderer` and `SparkRenderer` registration.
- Reuse the main animation loop.
- Reuse the existing `AudioContext` and analyser when available.
- Mount controls into the existing product UI instead of copying demo CSS wholesale.
- Keep the transition as an isolated controller with explicit `startRelease`, `enter`, `reset`, `update`, and `dispose` ownership.
- Dispose the persistent scene mesh, its inactive preloaded source, proxy field, and media nodes when switching catalogs repeatedly.
