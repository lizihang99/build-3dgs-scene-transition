import * as THREE from "three";
import { PackedSplats, SplatMesh, dyno, type GsplatModifier } from "@sparkjsdev/spark";
import { INCOMING_SCENE, OUTGOING_SCENE, type TransitionSceneSpec } from "./transitionConfig";

interface SplatControls {
  progress: ReturnType<typeof dyno.dynoFloat>;
  modifier: GsplatModifier;
}

type TransitionDirection = "release" | "gather";
type SceneKey = "outgoing" | "incoming";

export interface SplatPairState {
  oldVisible: boolean;
  newVisible: boolean;
  oldSplats: number;
  newSplats: number;
}

function createTransitionControls(
  spec: TransitionSceneSpec,
  direction: TransitionDirection
): SplatControls {
  const progress = dyno.dynoFloat(0);
  const wind = dyno.dynoVec3(new THREE.Vector3(...spec.wind));
  const accentColor = new THREE.Color(spec.accent);
  const accent = dyno.dynoVec3(new THREE.Vector3(accentColor.r, accentColor.g, accentColor.b));

  const modifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const transition = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          progress: "float",
          wind: "vec3",
          accent: "vec3"
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
          dyno.unindentLines(`
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
      return transition.apply({ gsplat, progress, wind, accent });
    }
  );

  return { progress, modifier };
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
}

export class SplatTransitionPair {
  private readonly outgoingSource = new PackedSplats({ url: OUTGOING_SCENE.url });
  private readonly incomingSource = new PackedSplats({ url: INCOMING_SCENE.url });
  private readonly releaseControls = createTransitionControls(OUTGOING_SCENE, "release");
  private readonly gatherControls = createTransitionControls(INCOMING_SCENE, "gather");
  private mesh?: SplatMesh;
  private activeSource?: SceneKey;

  constructor(private readonly scene: THREE.Scene) {}

  async load() {
    await Promise.all([this.outgoingSource.initialized, this.incomingSource.initialized]);

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
    this.gatherControls.progress.value = clamp01(progress);
    mesh.visible = true;
    mesh.needsUpdate = true;
  }

  settle() {
    const mesh = this.requireMesh();
    this.switchSource("incoming");
    this.gatherControls.progress.value = 1;
    mesh.visible = true;
    mesh.needsUpdate = true;
  }

  state(): SplatPairState {
    const visible = Boolean(this.mesh?.visible && this.mesh.parent === this.scene);
    return {
      oldVisible: visible && this.activeSource === "outgoing",
      newVisible: visible && this.activeSource === "incoming",
      oldSplats: this.outgoingSource.numSplats,
      newSplats: this.incomingSource.numSplats
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

  private switchSource(key: SceneKey) {
    const mesh = this.requireMesh();
    const source = key === "outgoing" ? this.outgoingSource : this.incomingSource;
    const spec = key === "outgoing" ? OUTGOING_SCENE : INCOMING_SCENE;
    const controls = key === "outgoing" ? this.releaseControls : this.gatherControls;

    if (this.activeSource !== key || mesh.splats !== source) {
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
    }
  }

  private requireMesh() {
    if (!this.mesh) throw new Error("3DGS scene pair has not finished loading");
    return this.mesh;
  }
}
