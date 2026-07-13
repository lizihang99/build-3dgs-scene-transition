# Current Effect Contract

## Purpose

Reproduce a convincing transition between unrelated 3DGS scenes without requiring splat correspondence. The old scene must visibly dissolve, the middle state must remain visually compatible with Gaussian splats, and the new scene must gather from the same visual language.

## Interaction

- Start in `STANDBY` with the outgoing scene visible.
- First action changes to `LOADING`, starts the licensed sample music, and runs release-to-hold.
- Stop in `READY`; show the proxy GSplat field continuously and keep it moving.
- Second action changes to `ENTERED`, fades the control, produces a forward compression/surge, then gathers the incoming scene.
- Do not add automatic playback by default. Query-controlled autoplay may exist for tests.

## Timing

- Release-to-ready: 4.5 seconds by default.
- Enter-to-settled: 2.7 seconds by default.
- During enter, reserve roughly the first 44% for the forward surge before revealing the incoming scene.
- Advance state progress with real elapsed time. Clamp only the motion simulation time step.

## Rendering

- Render outgoing and incoming content as native 3DGS data through one persistent scene `SplatMesh`.
- Preload both scene sources, hide the persistent mesh during Hold, and swap its source before Gather. Do not keep two modifier-driven scene meshes active in Spark 2.1.x.
- Render the middle field as editable/generated `SplatMesh` Gaussian splats, not point sprites.
- Use a synthetic proxy field when the two source scenes have unrelated topology or splat counts.
- Disable proxy frustum culling because the GPU modifier moves positions outside the packed source bounds.
- Keep the proxy in camera-local space so its framing is stable across scene transforms.

## Motion

- Base distribution: distant ellipsoidal cloud, not a flat ribbon or a near-camera wall.
- Primary motion: multi-scale divergence-free Curl-like field.
- Secondary motion: five softly attracting spectral filaments.
- Depth: three phase-offset breathing groups plus pulse-driven compression waves.
- Edge atmosphere: a sparse, slower outer GSplat shell and a subtle transition-only cyan edge haze.
- Avoid rigid S-curves, fully random per-particle shaking, and permanent full-axis rotation around the camera.

## Material And Color

- Keep splats small enough to read as Gaussian material particles rather than large blurred discs.
- Mix small bright cores with sparse, larger, low-alpha halos.
- Use restrained cold cyan and mist white with only a small trace of the outgoing warm color.
- Avoid rainbow palettes, dominant magenta/gold, and full-screen bloom.
- Do not use an overexposure flash.

## Audio

- Bundled sample: `Cipher` by Kevin MacLeod, CC BY 4.0.
- Start audio from a user gesture.
- Show a minimal play/pause control and four-band monitor.
- Keep autonomous motion when music is paused; audio response returns smoothly to zero.

## Debug Contract

Expose at least:

- readiness, flow state, phase, transition progress, and playing state;
- old/new scene visibility, active source, and splat counts;
- proxy primitive, motion model, count, opacity, version, and surge;
- audio-reactive flag, audio playing state, track name, low/mid/high/energy, and pulse;
- replay/seek controls and a canvas pixel-stat probe for automated validation.
