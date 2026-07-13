# Motion And FFT Mapping

## Spectral Filament Field

Use a synthetic packed seed per proxy splat. Derive stable hash values for mass, filament assignment, color group, halo class, and visibility. Keep assignments stable across frames.

Build the hold motion from:

1. An ellipsoidal cloud centered around `z = -5.6` in camera-local space.
2. A low-frequency Curl-like field for coherent global motion.
3. A higher-frequency Curl-like octave for local eddies.
4. Five helical filament targets with soft, per-particle attraction.
5. A bounded twist oscillation around the cloud center.
6. Three phase-offset depth groups.
7. A sparse outer shell with larger scale and lower alpha.

Do not integrate arbitrary random acceleration on the CPU. Keep position generation on the GPU and deterministic from seed, time, progress, and audio uniforms.

## FFT Bands

Use an `AnalyserNode` with an FFT size around 1024 and asymmetric smoothing. The bundled engine maps:

| Signal | Range | Visual mapping |
| --- | --- | --- |
| Low | 25-250 Hz | depth breathing and filament radius |
| Mid | 250-2000 Hz | flow speed, Curl displacement, filament attraction |
| High | 2000-9000 Hz | fluorescent core brightness and density |
| Energy | 25-9000 Hz | orbit amplitude and filament coherence |
| Pulse | positive spectral rise | traveling compression wave |

Scale raw band values conservatively in the shader and clamp to `[0, 1]`. Use approximately 70% autonomous motion and 30% audio response.

## Smoothing

- Use a fast attack and slower decay for bands.
- Derive pulse from positive low/energy change.
- Decay pulse exponentially over roughly 150-250ms.
- Return all audio values to zero when paused.
- Never map raw FFT bins directly to splat positions.

## Visual Tuning

- Increase mid response before increasing random turbulence.
- Increase low response in depth, not uniform particle scale, to avoid particles hitting the camera.
- Keep high-frequency scale response under about 10%; prefer color/alpha response.
- Drive edge atmosphere more slowly than the core field.
- Keep audio color shifts narrow; do not turn the field into a spectrum visualizer unless explicitly requested.
