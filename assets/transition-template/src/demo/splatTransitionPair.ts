import * as THREE from "three";
import { PackedSplats, SplatMesh, dyno, type GsplatModifier } from "@sparkjsdev/spark";
import { INCOMING_SCENE, OUTGOING_SCENE, type TransitionSceneSpec } from "./transitionConfig";

interface SplatControls {
  progress: ReturnType<typeof dyno.dynoFloat>;
  revealCenter: ReturnType<typeof dyno.dynoVec3>;
  revealHalfExtent: ReturnType<typeof dyno.dynoVec3>;
  modifier: GsplatModifier;
}

type TransitionDirection = "release" | IncomingRevealMode;
type SceneKey = "outgoing" | "incoming";
type ModifierKey = "release" | IncomingRevealMode;

export type IncomingRevealMode = "gather" | "center-bloom";

export interface SplatPairState {
  oldVisible: boolean;
  newVisible: boolean;
  oldSplats: number;
  newSplats: number;
  revealMode: IncomingRevealMode;
  revealProgress: number;
}

function createTransitionControls(
  spec: TransitionSceneSpec,
  direction: TransitionDirection
): SplatControls {
  const progress = dyno.dynoFloat(0);
  const wind = dyno.dynoVec3(new THREE.Vector3(...spec.wind));
  const accentColor = new THREE.Color(spec.accent);
  const accent = dyno.dynoVec3(new THREE.Vector3(accentColor.r, accentColor.g, accentColor.b));
  const revealCenter = dyno.dynoVec3(new THREE.Vector3());
  const revealHalfExtent = dyno.dynoVec3(new THREE.Vector3(1, 1, 1));

  const modifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const transition = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          progress: "float",
          wind: "vec3",
          accent: "vec3",
          revealCenter: "vec3",
          revealHalfExtent: "vec3"
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            vec3 transitionHash3(vec3 p) {
              p = fract(p * vec3(443.897, 441.423, 437.195));
              p += dot(p, p.yzx + 19.19);
              return fract((p.xxy + p.yzz) * p.zyx);
            }
          `)
        ],
        statements: ({ inputs, outputs }) =>
          direction === "center-bloom"
            ? dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 h = transitionHash3(${inputs.gsplat}.center);
              vec3 halfExtent = max(${inputs.revealHalfExtent}, vec3(0.0001));
              vec3 fromCenter = ${inputs.gsplat}.center - ${inputs.revealCenter};
              vec3 normalized = fromCenter / halfExtent;
              float radius = clamp(length(normalized * vec3(0.82, 1.04, 0.9)) / 1.38, 0.0, 1.0);
              float wave = ${inputs.progress} * 1.58 - radius * 1.08 + (h.x - 0.5) * 0.13;
              float local = smoothstep(0.015, 0.34, wave);
              float eased = local * local * (3.0 - 2.0 * local);
              vec3 radialDirection = normalize(fromCenter + (h - 0.5) * halfExtent * 0.012 + vec3(0.0001));
              vec3 tangent = normalize(cross(radialDirection, vec3(0.13, 1.0, 0.21)) + (h - 0.5) * 0.2);
              float sceneRadius = length(halfExtent);
              vec3 core = ${inputs.revealCenter} + radialDirection * sceneRadius * mix(0.012, 0.08, h.y);
              vec3 position = mix(core, ${inputs.gsplat}.center, eased);
              position += radialDirection * sin(local * 3.14159) * sceneRadius * mix(0.018, 0.052, h.z);
              position += tangent * sin(local * 3.14159) * sceneRadius * mix(0.012, 0.035, h.x) * (1.0 - ${inputs.progress} * 0.35);
              ${outputs.gsplat}.center = position;
              float alpha = smoothstep(0.08, 0.86, local);
              float coreGlow = (1.0 - smoothstep(0.2, 0.92, local)) * smoothstep(0.0, 0.42, ${inputs.progress});
              vec3 bloomColor = mix(${inputs.accent} * 1.38, vec3(0.72, 0.95, 1.0), 0.42 + h.y * 0.18);
              ${outputs.gsplat}.rgba.rgb = mix(bloomColor, ${outputs.gsplat}.rgba.rgb, smoothstep(0.24, 0.98, local));
              ${outputs.gsplat}.rgba.rgb *= 0.78 + alpha * 0.22 + coreGlow * 0.34;
              ${outputs.gsplat}.rgba.w *= alpha;
              ${outputs.gsplat}.scales *= mix(0.05, 1.0, smoothstep(0.02, 0.96, local));
            `)
            : dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 h = transitionHash3(${inputs.gsplat}.center);
              float p = ${direction === "gather" ? `1.0 - ${inputs.progress}` : inputs.progress};
              vec3 windNorm = normalize(${inputs.wind} + vec3(0.0001, 0.0, 0.0));
              float projection = dot(${inputs.gsplat}.center, windNorm) / 6.0 + 0.5;
              float local = clamp(p * 1.7 - h.x * 0.25 - projection * 0.45, 0.0, 1.0);
              float eased = local * local;
              vec3 direction = normalize(${inputs.wind} + (h - 0.5) * 1.6);
              ${outputs.gsplat}.center += direction * (eased * 2.4);
              ${outputs.gsplat}.scales *= max(1.0 - local * 0.9, 0.02);
              vec3 dustColor = ${inputs.accent} * (1.0 + eased * 2.2);
              ${outputs.gsplat}.rgba.rgb = mix(${outputs.gsplat}.rgba.rgb, dustColor, local * 0.6);
              ${outputs.gsplat}.rgba.w *= 1.0 - local;
            `)
      });
      return transition.apply({ gsplat, progress, wind, accent, revealCenter, revealHalfExtent });
    }
  );

  return { progress, revealCenter, revealHalfExtent, modifier };
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
}

function resolveRevealMode(mode: unknown): IncomingRevealMode {
  return mode === "gather" ? "gather" : "center-bloom";
}

function quantile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)));
  return values[index];
}

function computeRevealBounds(source: PackedSplats) {
  const count = Math.max(0, source.numSplats);
  if (count === 0) {
    return {
      center: new THREE.Vector3(),
      halfExtent: new THREE.Vector3(1, 1, 1)
    };
  }

  const stride = Math.max(1, Math.floor(count / 4096));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let index = 0; index < count; index += stride) {
    const splat = source.getSplat(index);
    xs.push(splat.center.x);
    ys.push(splat.center.y);
    zs.push(splat.center.z);
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  const low = new THREE.Vector3(quantile(xs, 0.01), quantile(ys, 0.01), quantile(zs, 0.01));
  const high = new THREE.Vector3(quantile(xs, 0.99), quantile(ys, 0.99), quantile(zs, 0.99));
  const center = low.clone().add(high).multiplyScalar(0.5);
  const halfExtent = high.clone().sub(low).multiplyScalar(0.5);
  halfExtent.set(
    Math.max(halfExtent.x, 0.0001),
    Math.max(halfExtent.y, 0.0001),
    Math.max(halfExtent.z, 0.0001)
  );
  return { center, halfExtent };
}

export class SplatTransitionPair {
  private readonly outgoingSource = new PackedSplats({ url: OUTGOING_SCENE.url });
  private readonly incomingSource = new PackedSplats({ url: INCOMING_SCENE.url });
  private readonly releaseControls = createTransitionControls(OUTGOING_SCENE, "release");
  private readonly gatherControls = createTransitionControls(INCOMING_SCENE, "gather");
  private readonly centerBloomControls = createTransitionControls(INCOMING_SCENE, "center-bloom");
  private mesh?: SplatMesh;
  private activeSource?: SceneKey;
  private activeModifier?: ModifierKey;
  private incomingRevealMode: IncomingRevealMode = "center-bloom";
  private incomingRevealProgress = 0;

  constructor(private readonly scene: THREE.Scene) {}

  async load() {
    await Promise.all([this.outgoingSource.initialized, this.incomingSource.initialized]);
    this.updateIncomingRevealBounds();

    this.mesh = new SplatMesh({
      splats: this.outgoingSource,
      editable: false,
      raycastable: false
    });
    this.mesh.packedSplats = this.outgoingSource;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.scene.add(this.mesh);
    this.reset();
  }

  reset() {
    const mesh = this.requireMesh();
    this.switchSource("outgoing");
    this.releaseControls.progress.value = 0;
    mesh.visible = true;
    mesh.needsUpdate = true;
  }

  setRevealMode(mode: IncomingRevealMode) {
    const nextMode = resolveRevealMode(mode);
    if (nextMode === this.incomingRevealMode) return;
    this.incomingRevealMode = nextMode;
    this.syncIncomingProgress(this.incomingRevealProgress);
    if (this.mesh && this.activeSource === "incoming") {
      this.activeModifier = undefined;
      this.switchSource("incoming");
      this.mesh.visible = true;
      this.mesh.needsUpdate = true;
    }
  }

  setReleaseProgress(progress: number) {
    const mesh = this.requireMesh();
    this.switchSource("outgoing");
    this.releaseControls.progress.value = clamp01(progress);
    mesh.visible = true;
    mesh.needsUpdate = true;
  }

  enterHold() {
    this.requireMesh().visible = false;
  }

  setGatherProgress(progress: number) {
    const mesh = this.requireMesh();
    this.switchSource("incoming");
    this.syncIncomingProgress(progress);
    mesh.visible = true;
    mesh.needsUpdate = true;
  }

  settle() {
    const mesh = this.requireMesh();
    this.switchSource("incoming");
    this.syncIncomingProgress(1);
    mesh.visible = true;
    mesh.needsUpdate = true;
  }

  state(): SplatPairState {
    const visible = Boolean(this.mesh?.visible && this.mesh.parent === this.scene);
    return {
      oldVisible: visible && this.activeSource === "outgoing",
      newVisible: visible && this.activeSource === "incoming",
      oldSplats: this.outgoingSource.numSplats,
      newSplats: this.incomingSource.numSplats,
      revealMode: this.incomingRevealMode,
      revealProgress: this.incomingRevealProgress
    };
  }

  dispose() {
    if (!this.mesh) {
      this.outgoingSource.dispose();
      this.incomingSource.dispose();
      return;
    }

    this.scene.remove(this.mesh);
    const ownedSource = this.mesh.packedSplats;
    this.mesh.dispose();
    if (ownedSource !== this.outgoingSource) this.outgoingSource.dispose();
    if (ownedSource !== this.incomingSource) this.incomingSource.dispose();
    this.mesh = undefined;
  }

  private syncIncomingProgress(progress: number) {
    this.incomingRevealProgress = clamp01(progress);
    this.gatherControls.progress.value = this.incomingRevealProgress;
    this.centerBloomControls.progress.value = this.incomingRevealProgress;
  }

  private updateIncomingRevealBounds() {
    const bounds = computeRevealBounds(this.incomingSource);
    for (const controls of [this.gatherControls, this.centerBloomControls]) {
      controls.revealCenter.value = bounds.center.clone();
      controls.revealHalfExtent.value = bounds.halfExtent.clone();
    }
  }

  private incomingControls() {
    return this.incomingRevealMode === "gather" ? this.gatherControls : this.centerBloomControls;
  }

  private switchSource(key: SceneKey) {
    const mesh = this.requireMesh();
    const source = key === "outgoing" ? this.outgoingSource : this.incomingSource;
    const spec = key === "outgoing" ? OUTGOING_SCENE : INCOMING_SCENE;
    const controls = key === "outgoing" ? this.releaseControls : this.incomingControls();
    const modifierKey: ModifierKey = key === "outgoing" ? "release" : this.incomingRevealMode;

    if (this.activeSource !== key || this.activeModifier !== modifierKey || mesh.splats !== source) {
      mesh.visible = false;
      mesh.packedSplats = source;
      mesh.splats = source;
      mesh.objectModifier = controls.modifier;
      mesh.position.set(...spec.position);
      mesh.rotation.set(...spec.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]);
      mesh.scale.setScalar(spec.scale);
      mesh.updateMatrixWorld(true);
      mesh.updateGenerator();
      mesh.updateMappingVersion();
      this.activeSource = key;
      this.activeModifier = modifierKey;
    }
  }

  private requireMesh() {
    if (!this.mesh) throw new Error("3DGS scene pair has not finished loading");
    return this.mesh;
  }
}
