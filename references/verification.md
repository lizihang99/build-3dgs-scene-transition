# Verification

## Static And Build Checks

Run from the generated demo:

```bash
npm ci
npm run build
npm test
```

Also run `git diff --check` when integrated into a repository.

## Required Browser Flow

1. Load with autoplay disabled.
2. Confirm the outgoing scene and both scene splat counts are nonzero.
3. Click the first action as a real user gesture.
4. Confirm music plays and FFT energy becomes nonzero.
5. Confirm the transition stops in `READY` with both source scenes hidden.
6. Capture two hold screenshots at least 500ms apart; the proxy field must visibly change without changing phase/progress.
7. Pause audio and confirm all FFT values decay to zero while autonomous motion continues.
8. Click enter and confirm surge occurs before incoming scene visibility.
9. Confirm the settled state contains the incoming scene and proxy opacity is near zero.
10. Repeat layout checks at approximately 390x844 and 1280x800.

## Canvas Checks

- Hold `nonDarkFraction` must exceed the blank-frame threshold used by the bundled contract.
- Average luminance must remain readable without full-screen overexposure.
- Verify the WebGL canvas is nonblank and non-uniform after scene load, during hold, and after settle. A luminance standard deviation check prevents a flat background from passing as a rendered scene.
- Confirm the settled screenshot is visually different from the outgoing screenshot and shows the configured incoming asset.
- Treat screenshots as required evidence for visual work; state values alone cannot prove framing.

## Common Failures

- Blank hold field: disable proxy frustum culling and verify camera-local depth remains negative.
- Cloud disappears periodically: rotate offsets around the cloud center, not positions around the camera origin.
- Low-frame-rate transition runs slowly: advance progress with wall-clock delta; clamp only motion delta.
- Particles look like another material: keep the proxy as Gaussian splats and avoid point sprites.
- Motion is technically changing but visually static: increase coherent field displacement or flow speed, not random noise.
- Audio values stay zero: start/resume the audio context inside a trusted user gesture and verify CORS for remote media.
- HTTPS automation fails: use a test browser context that explicitly accepts the local self-signed certificate; do not weaken production TLS settings.
