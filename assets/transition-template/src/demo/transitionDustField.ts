import * as THREE from "three";
import { SplatMesh, dyno, type PackedSplats } from "@sparkjsdev/spark";

export const RELEASE_END = 0.375;
export const HOLD_END = 0.625;

export type TransitionDustPhase = "release" | "hold" | "gather" | "settled";

export interface TransitionDustState {
  phase: TransitionDustPhase;
  primitive: "gsplat";
  motionModel: "spectral-filament";
  version: number;
  count: number;
  opacity: number;
  visibleFraction: number;
  surge: number;
  audioEnergy: number;
  audioPulse: number;
  drawCalls: number;
}

export interface TransitionDustAudioFrame {
  low: number;
  mid: number;
  high: number;
  energy: number;
  pulse: number;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function phaseForProgress(progress: number): TransitionDustPhase {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p >= 1) return "settled";
  if (p < RELEASE_END) return "release";
  if (p < HOLD_END) return "hold";
  return "gather";
}

function opacityForProgress(progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p < RELEASE_END) return smoothstep(0, 0.65, p / RELEASE_END);
  if (p < HOLD_END) return 1;
  if (p >= 1) return 0;
  const gather = (p - HOLD_END) / (1 - HOLD_END);
  return 1 - smoothstep(0.06, 0.95, gather);
}

function visibleFractionForProgress(progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p < RELEASE_END) return 0.35 + smoothstep(0, 0.82, p / RELEASE_END) * 0.43;
  if (p < HOLD_END) return 0.78 - smoothstep(0.08, 0.88, (p - RELEASE_END) / (HOLD_END - RELEASE_END)) * 0.1;
  const gather = (p - HOLD_END) / (1 - HOLD_END);
  return 1 - smoothstep(0.18, 1, gather) * 0.88;
}

export function surgeForProgress(progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  let surge = 0;
  if (p < RELEASE_END) {
    const release = p / RELEASE_END;
    surge =
      1.45 *
      smoothstep(0.08, 0.42, release) *
      (1 - smoothstep(0.58, 0.98, release));
  } else if (p < HOLD_END) {
    const hold = (p - RELEASE_END) / (HOLD_END - RELEASE_END);
    surge = 0.32 * (1 - smoothstep(0.12, 0.86, hold));
  } else if (p < 1) {
    const gather = (p - HOLD_END) / (1 - HOLD_END);
    surge =
      1.75 *
      smoothstep(0.02, 0.18, gather) *
      (1 - smoothstep(0.34, 0.72, gather));
  }
  return Math.max(0, surge);
}

function populateSplats(splats: PackedSplats, count: number) {
  const random = seededRandom(0x6d2b79f5);
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const rotation = new THREE.Euler();
  const color = new THREE.Color("#d9956a");

  for (let index = 0; index < count; index++) {
    center.set(random(), random(), random());

    const major = THREE.MathUtils.lerp(0.014, 0.06, Math.pow(random(), 2.2));
    const minor = major * THREE.MathUtils.lerp(0.16, 0.56, random());
    const depth = major * THREE.MathUtils.lerp(0.2, 0.72, random());
    scales.set(major, minor, depth);

    rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI * 2);
    quaternion.setFromEuler(rotation);

    const opacity = THREE.MathUtils.lerp(0.24, 0.62, Math.pow(random(), 0.7));
    splats.pushSplat(center, scales, quaternion, opacity, color);
  }
}

function createBridgeModifier() {
  const progress = dyno.dynoFloat(0);
  const time = dyno.dynoFloat(0);
  const opacity = dyno.dynoFloat(0);
  const visibleFraction = dyno.dynoFloat(0.35);
  const surge = dyno.dynoFloat(0);
  const audioLow = dyno.dynoFloat(0);
  const audioMid = dyno.dynoFloat(0);
  const audioHigh = dyno.dynoFloat(0);
  const audioEnergy = dyno.dynoFloat(0);
  const audioPulse = dyno.dynoFloat(0);
  const fromColorValue = new THREE.Color("#d9956a");
  const toColorValue = new THREE.Color("#73cce8");
  const fromColor = dyno.dynoVec3(new THREE.Vector3(fromColorValue.r, fromColorValue.g, fromColorValue.b));
  const toColor = dyno.dynoVec3(new THREE.Vector3(toColorValue.r, toColorValue.g, toColorValue.b));

  const modifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const bridge = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          progress: "float",
          time: "float",
          opacity: "float",
          visibleFraction: "float",
          surge: "float",
          audioLow: "float",
          audioMid: "float",
          audioHigh: "float",
          audioEnergy: "float",
          audioPulse: "float",
          fromColor: "vec3",
          toColor: "vec3"
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            vec3 bridgeHash3(vec3 p) {
              p = fract(p * vec3(443.897, 441.423, 437.195));
              p += dot(p, p.yzx + 19.19);
              return fract((p.xxy + p.yzz) * p.zyx);
            }

            float bridgeEase(float value) {
              float t = clamp(value, 0.0, 1.0);
              return t * t * (3.0 - 2.0 * t);
            }

            vec3 bridgeCurlFlow(vec3 p, float t) {
              return vec3(
                cos(p.y * 1.13 + t) - sin(p.z * 0.91 - t * 0.73),
                cos(p.z * 1.07 + t * 0.81) - sin(p.x * 1.19 + t * 0.62),
                cos(p.x * 0.97 - t * 0.76) - sin(p.y * 1.11 + t * 0.88)
              );
            }
          `)
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};

            vec3 seed = ${inputs.gsplat}.center;
            vec3 h = bridgeHash3(seed);
            float release = clamp(${inputs.progress} / ${RELEASE_END.toFixed(3)}, 0.0, 1.0);
            float hold = clamp((${inputs.progress} - ${RELEASE_END.toFixed(3)}) / ${(HOLD_END - RELEASE_END).toFixed(3)}, 0.0, 1.0);
            float gather = clamp((${inputs.progress} - ${HOLD_END.toFixed(3)}) / ${(1 - HOLD_END).toFixed(3)}, 0.0, 1.0);

            float mass = mix(0.72, 1.38, h.y);
            float releaseBlend = bridgeEase(release / 0.9);
            float gatherBlend = bridgeEase(gather / 0.9);
            float cloudEnergy = releaseBlend * (1.0 - gatherBlend);
            float surgePush = max(${inputs.surge}, 0.0);
            float fftLow = clamp(${inputs.audioLow} * 2.1, 0.0, 1.0);
            float fftMid = clamp(${inputs.audioMid} * 2.25, 0.0, 1.0);
            float fftHigh = clamp(${inputs.audioHigh} * 2.5, 0.0, 1.0);
            float fftEnergy = clamp(${inputs.audioEnergy} * 2.2, 0.0, 1.0);
            float fftPulse = clamp(${inputs.audioPulse}, 0.0, 1.0);

            vec3 source = vec3(
              (seed.x - 0.5) * 3.6,
              (seed.y - 0.5) * 2.4,
              -mix(2.0, 5.2, seed.z)
            );

            float theta = h.x * 6.28318;
            float cosPhi = h.y * 2.0 - 1.0;
            float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
            float cloudRadius = pow(max(h.z, 0.001), 0.42);
            float edgeMist = smoothstep(0.8, 0.98, h.z) * step(h.y, 0.62) * cloudEnergy;
            vec3 cloudCenter = vec3(0.0, 0.0, -5.6);
            vec3 cloudPosition = cloudCenter + vec3(
              cos(theta) * sinPhi * cloudRadius * 4.25,
              sin(theta) * sinPhi * cloudRadius * 2.55,
              cosPhi * cloudRadius * 2.05
            );
            cloudPosition.xy = cloudCenter.xy
              + (cloudPosition.xy - cloudCenter.xy) * mix(1.0, 1.26, edgeMist);
            cloudPosition.z -= edgeMist * mix(0.28, 0.72, h.x);

            float filamentId = floor(h.x * 5.0);
            float filamentPhase = filamentId * 1.25664 + ${inputs.time} * (0.16 + fftMid * 0.12);
            float filamentAxis = (h.z - 0.5) * 7.2;
            float filamentRadius = mix(1.6, 3.25, h.y) * (1.0 + fftLow * 0.14);
            vec3 filamentPosition = cloudCenter + vec3(
              sin(filamentAxis * 0.72 + filamentPhase) * filamentRadius,
              cos(filamentAxis * 0.48 - filamentPhase) * mix(0.72, 1.52, h.z),
              filamentAxis * 0.62 + sin(filamentPhase) * 0.34
            );
            float filamentMask = smoothstep(0.56, 0.94, h.y);
            float filamentAttraction = cloudEnergy * filamentMask * (0.12 + fftEnergy * 0.24);
            cloudPosition = mix(cloudPosition, filamentPosition, filamentAttraction);

            vec3 cloudOffset = cloudPosition - cloudCenter;
            float flowTime = ${inputs.time} * (1.0 + fftMid * 0.72) / mass;
            vec3 curlLow = bridgeCurlFlow(cloudOffset * 0.52 + h * 0.4, flowTime * 0.56);
            vec3 curlHigh = bridgeCurlFlow(cloudOffset * 1.28 + h * 2.1, -flowTime * 0.92);
            vec3 flowDirection = normalize(curlLow + curlHigh * 0.38 + vec3(0.001));
            vec3 radialDirection = normalize(cloudOffset + vec3(0.001));
            vec3 orbitDirection = normalize(cross(flowDirection, radialDirection) + vec3(0.001));
            float flowPhase = flowTime * mix(0.72, 1.16, h.z) + h.x * 6.28318;
            float vortexBand = sin(length(cloudOffset) * 1.35 - flowTime * 0.84 + h.y * 6.28318);
            cloudPosition += flowDirection * sin(flowPhase) * (0.72 + fftMid * 0.34) * cloudEnergy;
            cloudPosition += orbitDirection
              * (cos(flowPhase * 0.83) * (0.38 + fftEnergy * 0.18) + vortexBand * 0.28)
              * cloudEnergy;
            float compressionWave = sin(filamentAxis * 0.92 - flowTime * 4.2 + filamentId);
            cloudPosition += flowDirection * compressionWave * fftPulse * 0.86 * cloudEnergy;

            float twist = sin(${inputs.time} * 0.52) * 0.24 + sin(${inputs.time} * 0.21) * 0.1;
            float twistCos = cos(twist);
            float twistSin = sin(twist);
            vec2 centeredXZ = cloudPosition.xz - cloudCenter.xz;
            cloudPosition.xz = cloudCenter.xz + mat2(twistCos, -twistSin, twistSin, twistCos) * centeredXZ;
            cloudPosition.y += sin(${inputs.time} * 0.88 + theta * 2.0) * 0.3 * cloudEnergy;

            float depthLayer = floor(h.x * 3.0) * 2.0944;
            float depthWave = sin(${inputs.time} * 0.94 + depthLayer)
              + sin(${inputs.time} * 0.48 + h.y * 6.28318) * 0.28;
            cloudPosition.z += depthWave * mix(0.52, 0.96, h.z) * (1.0 + fftLow * 0.88) * cloudEnergy;

            vec3 target = vec3(
              (seed.x - 0.5) * 5.0,
              (seed.y - 0.5) * 3.0,
              -mix(2.4, 6.8, seed.z)
            );

            vec3 particlePosition = mix(source, cloudPosition, releaseBlend);
            vec3 burstDirection = normalize(vec3(-1.15, 0.12, 0.18) + (h - 0.5) * 1.25);
            particlePosition += burstDirection * sin(release * 3.14159) * mix(0.08, 0.5, h.z) * (1.0 - gatherBlend);
            particlePosition.z += surgePush * mix(0.48, 1.35, h.z);
            particlePosition.xy *= 1.0 + surgePush * mix(0.018, 0.055, h.x);
            particlePosition = mix(particlePosition, target, gatherBlend);

            float spring = gather * exp(-gather * 2.8)
              * sin(gather * 15.0 - ${inputs.time} * 0.7 + h.x * 6.28318);
            particlePosition += flowDirection * spring * 0.34;
            ${outputs.gsplat}.center = particlePosition;

            vec3 warmColor = ${inputs.fromColor} * mix(0.62, 1.12, h.y);
            warmColor = mix(warmColor, vec3(0.42, 0.08, 0.19), smoothstep(0.58, 0.82, h.x) * 0.46);
            warmColor = mix(warmColor, vec3(0.16, 0.27, 0.12), smoothstep(0.88, 1.0, h.x) * 0.42);

            vec3 coolColor = ${inputs.toColor} * mix(0.58, 1.08, h.z);
            coolColor = mix(coolColor, vec3(0.13, 0.27, 0.34), smoothstep(0.52, 0.84, h.y) * 0.42);
            coolColor = mix(coolColor, vec3(0.38, 0.20, 0.08), smoothstep(0.9, 1.0, h.z) * 0.3);

            float globalColorMix = smoothstep(0.24, 0.76, ${inputs.progress});
            float colorMix = clamp(globalColorMix + (h.x - 0.5) * 0.72 + (h.y - 0.5) * 0.12, 0.0, 1.0);
            vec3 sceneBridgeColor = mix(warmColor, coolColor, colorMix);

            float paletteBand = fract(h.x * 2.31 + h.y * 0.73 + h.z * 0.19);
            vec3 cyanGlow = vec3(0.16, 0.7, 0.82);
            vec3 mistGlow = vec3(0.58, 0.76, 0.76);
            vec3 warmTrace = vec3(0.68, 0.42, 0.3);
            vec3 fluorescentColor = mix(cyanGlow, mistGlow, smoothstep(0.16, 0.72, paletteBand));
            fluorescentColor = mix(fluorescentColor, warmTrace, smoothstep(0.88, 0.99, paletteBand) * 0.46);
            float colorWave = 0.9 + sin(${inputs.time} * 0.68 + h.z * 12.0) * 0.1;
            float haloClass = smoothstep(0.82, 0.97, h.z) * cloudEnergy;
            float coreClass = smoothstep(0.86, 1.0, h.y) * (1.0 - haloClass) * cloudEnergy;
            fluorescentColor *= colorWave * mix(1.08, 1.52, haloClass) * (1.0 + fftHigh * 0.48);
            fluorescentColor = mix(fluorescentColor, vec3(1.3, 1.42, 1.46), coreClass * 0.38);
            fluorescentColor = mix(fluorescentColor, vec3(0.18, 0.46, 0.52), edgeMist * 0.58);
            ${outputs.gsplat}.rgba.rgb = mix(
              sceneBridgeColor,
              fluorescentColor,
              cloudEnergy * mix(0.48, 0.72, h.y)
            );

            float visible = max(step(h.x, ${inputs.visibleFraction}), edgeMist * 0.72);
            float alphaVariation = mix(0.7, 1.0, h.y);
            float densityPulse = 0.82 + sin(${inputs.time} * mix(0.7, 1.8, h.z) + h.x * 18.0) * 0.18;
            densityPulse *= 1.0 + fftHigh * mix(0.08, 0.28, coreClass);
            ${outputs.gsplat}.rgba.a *= ${inputs.opacity}
              * visible
              * alphaVariation
              * densityPulse
              * mix(1.18, 0.44, haloClass)
              * mix(1.0, 0.48, edgeMist);

            float breathing = 1.0 + sin(${inputs.time} * mix(0.46, 0.9, 1.0 - edgeMist) + h.z * 19.0)
              * mix(0.12, 0.2, edgeMist) * cloudEnergy;
            float cloudScale = 1.0 + cloudEnergy * mix(0.08, 0.32, h.y) + fftLow * cloudEnergy * 0.1;
            float particleScale = mix(0.76, 1.38, haloClass);
            particleScale = mix(particleScale, 2.08, edgeMist);
            float motionStretch = cloudScale * particleScale + surgePush * mix(0.08, 0.24, h.z);
            ${outputs.gsplat}.scales *= vec3(motionStretch, breathing * cloudScale * particleScale, breathing * cloudScale * particleScale);
          `)
      });

      gsplat = bridge.apply({
        gsplat,
        progress,
        time,
        opacity,
        visibleFraction,
        surge,
        audioLow,
        audioMid,
        audioHigh,
        audioEnergy,
        audioPulse,
        fromColor,
        toColor
      }).gsplat;
      return { gsplat };
    }
  );

  return {
    modifier,
    progress,
    time,
    opacity,
    visibleFraction,
    surge,
    audioLow,
    audioMid,
    audioHigh,
    audioEnergy,
    audioPulse
  };
}

export class TransitionDustField {
  readonly mesh: SplatMesh;
  readonly initialized: Promise<void>;
  readonly count: number;
  private readonly controls: ReturnType<typeof createBridgeModifier>;
  private progress = 0;
  private opacity = 0;
  private visibleFraction = 0.35;
  private surge = 0;
  private audioEnergy = 0;
  private audioPulse = 0;

  constructor(count = 3600) {
    this.count = Math.max(1, Math.round(count));
    this.controls = createBridgeModifier();
    this.mesh = new SplatMesh({
      maxSplats: this.count,
      editable: false,
      raycastable: false,
      objectModifier: this.controls.modifier,
      constructSplats: (splats) => populateSplats(splats, this.count)
    });
    this.mesh.name = "transition-dust-gsplats";
    // The GPU modifier moves splats well outside their packed 0..1 source bounds.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.initialized = this.mesh.initialized.then(() => undefined);
  }

  capture(camera: THREE.Camera) {
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.mesh.position);
    camera.getWorldQuaternion(this.mesh.quaternion);
    this.mesh.updateMatrixWorld(true);
  }

  update(progress: number, timeSec: number, surgeOverride?: number, audio?: TransitionDustAudioFrame) {
    const nextProgress = THREE.MathUtils.clamp(Number(progress) || 0, 0, 1);
    const nextTime = Math.max(0, Number(timeSec) || 0);
    const changed =
      Math.abs(nextProgress - this.progress) > 0.000001 || Math.abs(nextTime - this.controls.time.value) > 0.000001;

    this.progress = nextProgress;
    this.opacity = opacityForProgress(nextProgress);
    this.visibleFraction = visibleFractionForProgress(nextProgress);
    this.surge = surgeOverride === undefined ? surgeForProgress(nextProgress) : Math.max(0, surgeOverride);
    const nextAudio = audio ?? { low: 0, mid: 0, high: 0, energy: 0, pulse: 0 };
    this.audioEnergy = THREE.MathUtils.clamp(nextAudio.energy, 0, 1);
    this.audioPulse = THREE.MathUtils.clamp(nextAudio.pulse, 0, 1);
    this.controls.progress.value = this.progress;
    this.controls.time.value = nextTime;
    this.controls.opacity.value = this.opacity;
    this.controls.visibleFraction.value = this.visibleFraction;
    this.controls.surge.value = this.surge;
    this.controls.audioLow.value = THREE.MathUtils.clamp(nextAudio.low, 0, 1);
    this.controls.audioMid.value = THREE.MathUtils.clamp(nextAudio.mid, 0, 1);
    this.controls.audioHigh.value = THREE.MathUtils.clamp(nextAudio.high, 0, 1);
    this.controls.audioEnergy.value = this.audioEnergy;
    this.controls.audioPulse.value = this.audioPulse;
    this.mesh.visible = this.opacity > 0.004;
    if (changed && this.mesh.visible) this.mesh.needsUpdate = true;
  }

  state(): TransitionDustState {
    return {
      phase: phaseForProgress(this.progress),
      primitive: "gsplat",
      motionModel: "spectral-filament",
      version: this.mesh.version,
      count: this.count,
      opacity: this.opacity,
      visibleFraction: this.visibleFraction,
      surge: this.surge,
      audioEnergy: this.audioEnergy,
      audioPulse: this.audioPulse,
      drawCalls: 1
    };
  }

  dispose() {
    this.mesh.dispose();
  }
}
