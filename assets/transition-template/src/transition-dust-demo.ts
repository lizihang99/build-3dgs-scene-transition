import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer } from "@sparkjsdev/spark";
import { AudioEngine } from "./audio/audio";
import { SplatTransitionPair, type IncomingRevealMode } from "./demo/splatTransitionPair";
import {
  HOLD_END,
  RELEASE_END,
  TransitionDustField,
  phaseForProgress,
  type TransitionDustAudioFrame,
  type TransitionDustPhase
} from "./demo/transitionDustField";

type FlowState = "STANDBY" | "LOADING" | "READY" | "ENTERED";
type ActiveSegment = "release" | "enter" | null;

interface DemoState {
  ready: boolean;
  playing: boolean;
  flowState: FlowState;
  phase: TransitionDustPhase;
  progress: number;
  elapsedSec: number;
  durationSec: number;
  dustCount: number;
  dustPrimitive: "gsplat";
  dustMotionModel: "spectral-filament";
  dustVersion: number;
  dustOpacity: number;
  dustVisibleFraction: number;
  dustSurge: number;
  audioReactive: true;
  audioPlaying: boolean;
  audioTrack: "Cipher";
  audioLow: number;
  audioMid: number;
  audioHigh: number;
  audioEnergy: number;
  audioPulse: number;
  dustDrawCalls: number;
  oldVisible: boolean;
  newVisible: boolean;
  oldSplats: number;
  newSplats: number;
  revealMode: IncomingRevealMode;
  revealProgress: number;
}

interface PixelStats {
  width: number;
  height: number;
  averageLuminance: number;
  luminanceStdDev: number;
  nonDarkFraction: number;
}

interface TransitionDustDemoApi {
  state(): DemoState;
  activate(): DemoState;
  play(): DemoState;
  pause(): DemoState;
  replay(): DemoState;
  seek(progress: number): DemoState;
  setRevealMode(mode: IncomingRevealMode): DemoState;
  pixelStats(): PixelStats;
}

declare global {
  interface Window {
    __transitionDustDemo: TransitionDustDemoApi;
  }
}

const query = new URLSearchParams(location.search);
const autoplay = query.get("autoplay") === "1";
const releaseDurationSec = Math.max(0.35, Number(query.get("releaseDuration")) || 4.5);
const enterDurationSec = Math.max(0.35, Number(query.get("enterDuration")) || 2.7);
const durationSec = releaseDurationSec + enterDurationSec;
const readyProgress = HOLD_END - 0.002;
const initialRevealMode = resolveRevealMode(query.get("reveal") ?? query.get("revealMode"));

const viewport = requiredElement<HTMLElement>("viewport");
const loading = requiredElement<HTMLElement>("loading");
const loadingLabel = requiredElement<HTMLElement>("loading-label");
const actionUi = requiredElement<HTMLElement>("action-ui");
const actionButton = requiredElement<HTMLButtonElement>("action-button");
const actionSubtitle = requiredElement<HTMLElement>("action-subtitle");
const revealModeUi = requiredElement<HTMLElement>("reveal-mode-ui");
const revealModeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-reveal-mode]")];
const audioToggle = requiredElement<HTMLButtonElement>("audio-toggle");
const fftMeters = new Map(
  [...document.querySelectorAll<HTMLElement>("[data-fft-band]")].map((element) => [element.dataset.fftBand, element])
);

const scene = new THREE.Scene();
const oldBackground = new THREE.Color("#0c0810");
const voidBackground = new THREE.Color("#04050a");
const newBackground = new THREE.Color("#06131a");
const mixedBackground = new THREE.Color();
scene.background = oldBackground.clone();

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 500);
camera.position.set(0, 1.6, 0.01);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, -1);
controls.enableZoom = false;
controls.enablePan = false;
controls.enableDamping = true;
controls.rotateSpeed = -0.35;

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const splats = new SplatTransitionPair(scene);
splats.setRevealMode(initialRevealMode);
const dust = new TransitionDustField(resolveDustCount());
scene.add(dust.mesh);

const audio = new AudioEngine();
audio.setVolume(0.58);

let ready = false;
let playing = false;
let flowState: FlowState = "STANDBY";
let activeSegment: ActiveSegment = null;
let segmentElapsedSec = 0;
let progress = 0;
let dustTimeSec = 0;
let surgeOverride: number | undefined;
let lastFrameMs = performance.now();
let audioStarted = false;
let previousAudioLow = 0;
let previousAudioEnergy = 0;
const audioFrame: TransitionDustAudioFrame = { low: 0, mid: 0, high: 0, energy: 0, pulse: 0 };

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing demo element #${id}`);
  return element as T;
}

function resolveDustCount() {
  const requested = Number(query.get("count"));
  if (Number.isFinite(requested) && requested > 0) return THREE.MathUtils.clamp(Math.round(requested), 600, 6000);
  return innerWidth <= 560 ? 2400 : 3600;
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
}

function smoothstep(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function easeOutExpo(value: number) {
  const t = clamp01(value);
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
}

function resolveRevealMode(mode: unknown): IncomingRevealMode {
  return mode === "gather" ? "gather" : "center-bloom";
}

function updateBackground(value: number) {
  if (value < RELEASE_END) {
    mixedBackground.copy(oldBackground).lerp(voidBackground, value / RELEASE_END);
  } else if (value < HOLD_END) {
    const holdProgress = (value - RELEASE_END) / (HOLD_END - RELEASE_END);
    mixedBackground.copy(voidBackground).lerp(newBackground, holdProgress * 0.24);
  } else {
    const gatherProgress = (value - HOLD_END) / (1 - HOLD_END);
    mixedBackground.copy(voidBackground).lerp(newBackground, gatherProgress);
  }
  (scene.background as THREE.Color).copy(mixedBackground);
}

function applyTransition(value: number, revealIncoming = true) {
  progress = clamp01(value);
  if (ready) {
    if (progress < RELEASE_END) {
      splats.setReleaseProgress(progress / RELEASE_END);
    } else if (progress < HOLD_END || !revealIncoming) {
      splats.enterHold();
    } else if (progress < 1) {
      splats.setGatherProgress((progress - HOLD_END) / (1 - HOLD_END));
    } else {
      splats.settle();
    }
  }
  dust.update(progress, dustTimeSec, surgeOverride, audioFrame);
  updateBackground(progress);
  updateUi();
}

function updateUi() {
  document.body.dataset.flowState = flowState;
  actionUi.dataset.hidden = String(flowState === "ENTERED");
  actionButton.dataset.ready = String(flowState === "READY");
  const revealLocked = !ready || flowState === "LOADING" || flowState === "ENTERED";
  revealModeUi.dataset.locked = String(revealLocked);
  for (const button of revealModeButtons) {
    const mode = resolveRevealMode(button.dataset.revealMode);
    button.disabled = revealLocked;
    button.dataset.active = String(mode === splats.state().revealMode);
  }

  if (!ready) {
    actionButton.disabled = true;
    actionButton.textContent = "正在加载场景...";
    actionSubtitle.textContent = "AWAITING SIGNAL";
  } else if (flowState === "STANDBY") {
    actionButton.disabled = false;
    actionButton.textContent = "释放粒子 (START)";
    actionSubtitle.textContent = "HOLOGRAM READY";
  } else if (flowState === "LOADING") {
    actionButton.disabled = true;
    actionButton.textContent = "释放光晕能量中...";
    actionSubtitle.textContent = "IGNITING PARTICLES";
  } else if (flowState === "READY") {
    actionButton.disabled = false;
    actionButton.textContent = "进入空间 (ENTER)";
    actionSubtitle.textContent = "SPACE IS READY";
  } else {
    actionButton.disabled = true;
    actionButton.textContent = "空间载入完成";
    actionSubtitle.textContent = "ENTERING SPACE";
  }
}

function updateAudioUi() {
  const isPlaying = audio.playing;
  audioToggle.innerHTML = isPlaying ? "&#10074;&#10074;" : "&#9654;";
  audioToggle.title = isPlaying ? "Pause music" : "Play music";
  audioToggle.setAttribute("aria-label", isPlaying ? "Pause music" : "Play music");
  for (const band of ["low", "mid", "high", "energy"] as const) {
    const meter = fftMeters.get(band);
    if (meter) meter.style.transform = `scaleX(${Math.max(0.08, Math.min(1, audioFrame[band] * 2.4)).toFixed(3)})`;
  }
}

async function ensureAudioPlaying() {
  try {
    if (!audioStarted) {
      await audio.play("/audio/cipher-kevin-macleod.ogg", 120, 0, {
        fadeInSec: 0.8,
        gainDb: -4,
        loop: true
      });
      audioStarted = true;
    } else if (!audio.playing) {
      audio.setPaused(false);
    }
  } catch (error) {
    console.warn("music playback was not started", error);
  }
  updateAudioUi();
}

function toggleAudio() {
  if (!audioStarted) void ensureAudioPlaying();
  else {
    audio.togglePause();
    window.setTimeout(updateAudioUi, 90);
  }
}

function updateAudioFrame(deltaSec: number) {
  audio.update();
  const bands = audio.bands;
  const spectralRise = Math.max(0, bands.low - previousAudioLow) * 1.45
    + Math.max(0, bands.energy - previousAudioEnergy);
  audioFrame.low = bands.low;
  audioFrame.mid = bands.mid;
  audioFrame.high = bands.high;
  audioFrame.energy = bands.energy;
  audioFrame.pulse = Math.max(audioFrame.pulse * Math.exp(-deltaSec * 5.4), Math.min(1, spectralRise * 7.5));
  previousAudioLow = bands.low;
  previousAudioEnergy = bands.energy;
  updateAudioUi();
}

function renderOnce() {
  controls.update();
  renderer.render(scene, camera);
}

function currentState(): DemoState {
  const splatState = splats.state();
  const dustState = dust.state();
  return {
    ready,
    playing,
    flowState,
    phase: dustState.phase,
    progress: Number(progress.toFixed(4)),
    elapsedSec: Number(dustTimeSec.toFixed(3)),
    durationSec: Number(durationSec.toFixed(3)),
    dustCount: dustState.count,
    dustPrimitive: dustState.primitive,
    dustMotionModel: dustState.motionModel,
    dustVersion: dustState.version,
    dustOpacity: Number(dustState.opacity.toFixed(4)),
    dustVisibleFraction: Number(dustState.visibleFraction.toFixed(4)),
    dustSurge: Number(dustState.surge.toFixed(4)),
    audioReactive: true,
    audioPlaying: audio.playing,
    audioTrack: "Cipher",
    audioLow: Number(audioFrame.low.toFixed(4)),
    audioMid: Number(audioFrame.mid.toFixed(4)),
    audioHigh: Number(audioFrame.high.toFixed(4)),
    audioEnergy: Number(audioFrame.energy.toFixed(4)),
    audioPulse: Number(audioFrame.pulse.toFixed(4)),
    dustDrawCalls: dustState.drawCalls,
    ...splatState
  };
}

function activate() {
  if (!ready || playing) return currentState();
  if (flowState === "STANDBY") {
    void ensureAudioPlaying();
    flowState = "LOADING";
    activeSegment = "release";
    segmentElapsedSec = 0;
    playing = true;
  } else if (flowState === "READY") {
    flowState = "ENTERED";
    activeSegment = "enter";
    segmentElapsedSec = 0;
    surgeOverride = 0.18;
    playing = true;
    applyTransition(readyProgress, false);
    renderOnce();
  }
  updateUi();
  return currentState();
}

function play() {
  if (!ready) return currentState();
  if (activeSegment) playing = true;
  else if (flowState === "STANDBY" || flowState === "READY") return activate();
  return currentState();
}

function pause() {
  playing = false;
  return currentState();
}

function resetToStandby() {
  if (!ready) return currentState();
  splats.reset();
  dust.capture(camera);
  flowState = "STANDBY";
  activeSegment = null;
  segmentElapsedSec = 0;
  dustTimeSec = 0;
  surgeOverride = undefined;
  playing = false;
  applyTransition(0);
  renderOnce();
  return currentState();
}

function setRevealMode(mode: IncomingRevealMode) {
  if (flowState === "LOADING" || flowState === "ENTERED") return currentState();
  splats.setRevealMode(mode);
  updateUi();
  renderOnce();
  return currentState();
}

function replay() {
  resetToStandby();
  return activate();
}

function seek(value: number) {
  playing = false;
  activeSegment = null;
  surgeOverride = undefined;
  progress = clamp01(value);
  dustTimeSec = progress * durationSec;
  flowState = progress <= 0 ? "STANDBY" : progress < HOLD_END ? "LOADING" : progress < 1 ? "ENTERED" : "ENTERED";
  applyTransition(progress);
  renderOnce();
  return currentState();
}

function advanceTransition(deltaSec: number, motionDeltaSec: number) {
  if (!playing || !activeSegment) return;
  dustTimeSec += motionDeltaSec;
  segmentElapsedSec += deltaSec;

  if (activeSegment === "release") {
    const t = clamp01(segmentElapsedSec / releaseDurationSec);
    surgeOverride = undefined;
    applyTransition(readyProgress * smoothstep(t));
    if (t >= 1) {
      playing = false;
      activeSegment = null;
      flowState = "READY";
      applyTransition(readyProgress);
    }
    return;
  }

  const t = clamp01(segmentElapsedSec / enterDurationSec);
  const surgeEnd = 0.44;
  const surgeStrength = splats.state().revealMode === "center-bloom" ? 2.65 : 2.15;
  if (t < surgeEnd) {
    const surgeT = t / surgeEnd;
    surgeOverride = surgeStrength * smoothstep(surgeT);
    applyTransition(readyProgress, false);
  } else {
    const gatherT = (t - surgeEnd) / (1 - surgeEnd);
    const gatherEase = easeOutExpo(gatherT);
    surgeOverride = surgeStrength * (1 - smoothstep(gatherT));
    applyTransition(HOLD_END + (1 - HOLD_END) * gatherEase);
  }

  if (t >= 1) {
    playing = false;
    activeSegment = null;
    surgeOverride = undefined;
    applyTransition(1);
  }
}

function pixelStats(): PixelStats {
  const gl = renderer.getContext();
  if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.finish();
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let nonDark = 0;
  let sampled = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 12) {
    const offset = pixelIndex * 4;
    const luminance = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    if (luminance > 9) nonDark++;
    sampled++;
  }
  const averageLuminance = luminanceSum / Math.max(1, sampled);
  const luminanceVariance = Math.max(0, luminanceSquaredSum / Math.max(1, sampled) - averageLuminance ** 2);
  return {
    width,
    height,
    averageLuminance: Number(averageLuminance.toFixed(3)),
    luminanceStdDev: Number(Math.sqrt(luminanceVariance).toFixed(3)),
    nonDarkFraction: Number((nonDark / Math.max(1, sampled)).toFixed(5))
  };
}

window.__transitionDustDemo = { state: currentState, activate, play, pause, replay, seek, setRevealMode, pixelStats };

actionButton.addEventListener("click", activate);
audioToggle.addEventListener("click", toggleAudio);
for (const button of revealModeButtons) {
  button.addEventListener("click", () => setRevealMode(resolveRevealMode(button.dataset.revealMode)));
}
addEventListener("keydown", (event) => {
  if (event.code === "Enter" || event.code === "Space") {
    event.preventDefault();
    activate();
  } else if (event.key.toLowerCase() === "r") {
    resetToStandby();
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop((frameMs) => {
  const elapsedSec = Math.max(0, (frameMs - lastFrameMs) / 1000);
  const motionDeltaSec = Math.min(0.05, elapsedSec);
  lastFrameMs = frameMs;
  updateAudioFrame(motionDeltaSec);
  advanceTransition(elapsedSec, motionDeltaSec);
  if (!playing) {
    dustTimeSec += motionDeltaSec;
    dust.update(progress, dustTimeSec, surgeOverride, audioFrame);
  }
  renderOnce();
});

applyTransition(0);
updateAudioUi();

void Promise.all([splats.load(), dust.initialized])
  .then(() => {
    ready = true;
    dust.capture(camera);
    applyTransition(0);
    loading.hidden = true;
    if (autoplay) activate();
    else renderOnce();
  })
  .catch((error) => {
    loadingLabel.textContent = "Scene load failed";
    console.error("transition dust demo failed to load", error);
  });
