/**
 * 音频引擎:双轨等功率交叉淡化 + 实时 FFT 分频 + 节拍时钟 + 曲终检测。
 *
 * - 频段: low(kick/贝斯) mid(人声/和声) high(镲/空气感) + energy(整体)
 *   各自做 attack/decay 非对称平滑,避免粒子抽搐(DESIGN.md §6)。
 * - BeatClock: 由 bpm/offset 推算拍与小节,支持"下一小节边界"调度,
 *   转场与音频 crossfade 都对齐小节(DESIGN.md §2.1)。
 * - 听觉工艺(EXPERIENCE §2 附):
 *   · crossfade 用等功率曲线(cos/sin),线性 ramp 会在中段塌陷 -3dB;
 *   · 暂停/恢复经 60ms gain 包络,消除硬切咔哒;
 *   · 响度契约:manifest 可带 gainDb(管线离线按 -14 LUFS 目标测算),
 *     运行时只施加,不做动态归一。
 */

export interface Bands {
  low: number;
  mid: number;
  high: number;
  energy: number;
}

interface Track {
  el: HTMLAudioElement;
  gain: GainNode; // crossfade 曲线
  trim: GainNode; // 响度契约(gainDb)与暂停包络
  trimBase: number; // trim 的常态值 = dbToLinear(gainDb),暂停包络的回归点
  src: MediaElementAudioSourceNode;
  bpm: number;
  offsetSec: number;
  pausedAt: number | null;
  pauseTimer: number | null;
}

const ATTACK = 0.55; // 上行插值系数(快)
const DECAY = 0.12; // 下行插值系数(慢放)
const PAUSE_RAMP = 0.06; // TUNE: 暂停/恢复包络秒数(防咔哒)

/** 等功率淡化曲线(N 点);up=淡入 sin,down=淡出 cos */
function equalPowerCurve(up: boolean, n = 33): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (Math.PI / 2);
    c[i] = up ? Math.sin(x) : Math.cos(x);
  }
  return c;
}

const dbToLinear = (db: number) => Math.pow(10, db / 20);

export class AudioEngine {
  readonly ctx: AudioContext;
  private analyser: AnalyserNode;
  private master: GainNode;
  private masterVolume = 1;
  private presentationGainDb = 0;
  private presentationGainScale = 1;
  private fft: Uint8Array<ArrayBuffer>;
  private active: Track | null = null;
  private fading: Track | null = null;
  private smoothed: Bands = { low: 0, mid: 0, high: 0, energy: 0 };
  readonly bands: Bands = { low: 0, mid: 0, high: 0, energy: 0 };
  /** 自然曲终回调(顺播会话弧线的数据源;loop 模式下不触发) */
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.fft = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** 必须由用户手势触发一次 */
  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  setVolume(volume: number) {
    this.masterVolume = Math.min(1, Math.max(0, Number(volume) || 0));
    this.master.gain.value = this.masterVolume;
  }

  get volume() {
    return this.masterVolume;
  }

  setPresentationGainDb(gainDb: number, fadeSec = 0.35) {
    this.presentationGainDb = Math.max(-60, Math.min(0, Number(gainDb) || 0));
    this.presentationGainScale = dbToLinear(this.presentationGainDb);
    const apply = (tr: Track | null) => {
      if (!tr) return;
      const now = this.ctx.currentTime;
      const target = Math.max(0.0001, tr.trimBase * this.presentationGainScale);
      tr.trim.gain.cancelScheduledValues(now);
      tr.trim.gain.setValueAtTime(Math.max(0.0001, tr.trim.gain.value), now);
      if (fadeSec <= 0.01) tr.trim.gain.setValueAtTime(target, now);
      else tr.trim.gain.exponentialRampToValueAtTime(target, now + fadeSec);
    };
    apply(this.active);
    apply(this.fading);
  }

  debug() {
    return {
      volume: this.masterVolume,
      presentationGainDb: this.presentationGainDb,
      presentationGain: this.presentationGainScale,
      playing: this.playing
    };
  }

  setLooping(loop: boolean) {
    if (this.active) this.active.el.loop = loop;
  }

  private makeTrack(url: string, bpm: number, offsetSec: number, gainDb: number, loop: boolean): Track {
    const el = new Audio(url);
    el.crossOrigin = "anonymous"; // 未来网易云音源需经自建代理带 CORS 头
    el.loop = loop;
    el.preload = "auto";
    const src = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    const trim = this.ctx.createGain();
    const trimBase = dbToLinear(gainDb);
    trim.gain.value = Math.max(0.0001, trimBase * this.presentationGainScale);
    src.connect(trim);
    trim.connect(gain);
    gain.connect(this.master);
    const track: Track = { el, gain, trim, trimBase, src, bpm, offsetSec, pausedAt: null, pauseTimer: null };
    el.addEventListener("ended", () => {
      if (this.active === track && !el.loop) this.onEnded?.();
    });
    return track;
  }

  /** 首次播放/沉默后的新曲:短等功率淡入(不硬起) */
  async play(url: string, bpm: number, offsetSec = 0, opts?: { gainDb?: number; loop?: boolean; fadeInSec?: number }) {
    await this.resume();
    if (this.active) this.stopTrack(this.active);
    if (this.fading) {
      this.stopTrack(this.fading);
      this.fading = null;
    }
    this.active = this.makeTrack(url, bpm, offsetSec, opts?.gainDb ?? 0, opts?.loop ?? false);
    const t = this.ctx.currentTime;
    const fade = opts?.fadeInSec ?? 0.4; // TUNE: 新曲淡入
    this.active.gain.gain.setValueAtTime(0, t);
    this.active.gain.gain.setValueCurveAtTime(equalPowerCurve(true), t, Math.max(0.05, fade));
    await this.active.el.play();
  }

  /** 交叉淡化到新曲目(等功率),时长与视觉转场一致 */
  async crossfadeTo(url: string, bpm: number, offsetSec: number, durationSec: number, opts?: { gainDb?: number; loop?: boolean }) {
    await this.resume();
    const t = this.ctx.currentTime;
    if (this.fading) this.stopTrack(this.fading); // 上一次淡出未完成则直接截断
    const next = this.makeTrack(url, bpm, offsetSec, opts?.gainDb ?? 0, opts?.loop ?? false);
    const dur = Math.max(0.1, durationSec);
    next.gain.gain.setValueAtTime(0, t);
    next.gain.gain.setValueCurveAtTime(equalPowerCurve(true), t, dur);
    await next.el.play();

    if (this.active) {
      const old = this.active;
      // setValueCurveAtTime 不允许与既有调度重叠:先清后排
      old.gain.gain.cancelScheduledValues(t);
      const cur = Math.max(0.0001, old.gain.gain.value);
      old.gain.gain.setValueAtTime(cur, t);
      // 从当前值起的等功率淡出
      const curve = equalPowerCurve(false);
      for (let i = 0; i < curve.length; i++) curve[i] *= cur;
      old.gain.gain.setValueCurveAtTime(curve, t, dur);
      this.fading = old;
      setTimeout(() => {
        if (this.fading === old) {
          this.stopTrack(old);
          this.fading = null;
        }
      }, dur * 1000 + 120);
    }
    this.active = next;
  }

  private stopTrack(tr: Track) {
    if (tr.pauseTimer !== null) {
      window.clearTimeout(tr.pauseTimer);
      tr.pauseTimer = null;
    }
    tr.el.pause();
    tr.src.disconnect();
    tr.trim.disconnect();
    tr.gain.disconnect();
    tr.el.src = "";
  }

  /** 暂停/恢复:60ms 包络防咔哒 */
  togglePause(): boolean {
    const tr = this.active;
    if (!tr) return false;
    const shouldPause = tr.pausedAt === null && !tr.el.paused;
    this.setPaused(shouldPause);
    return shouldPause;
  }

  setPaused(paused: boolean) {
    const tr = this.active;
    if (!tr) return;
    if (paused) {
      const t = this.ctx.currentTime;
      tr.pausedAt = isFinite(tr.el.currentTime) ? tr.el.currentTime : 0;
      tr.trim.gain.cancelScheduledValues(t);
      tr.trim.gain.setValueAtTime(Math.max(0.0001, tr.trim.gain.value), t);
      tr.trim.gain.exponentialRampToValueAtTime(0.0001, t + PAUSE_RAMP);
      if (tr.pauseTimer !== null) window.clearTimeout(tr.pauseTimer);
      tr.pauseTimer = window.setTimeout(() => {
        tr.pauseTimer = null;
        tr.el.pause();
      }, PAUSE_RAMP * 1000 + 10);
    } else {
      if (tr.pauseTimer !== null) {
        window.clearTimeout(tr.pauseTimer);
        tr.pauseTimer = null;
      }
      if (tr.pausedAt !== null && isFinite(tr.el.currentTime) && Math.abs(tr.el.currentTime - tr.pausedAt) > 0.5) {
        try {
          tr.el.currentTime = tr.pausedAt;
        } catch {
          // Some media elements reject seeks until metadata is ready; play still resumes from browser state.
        }
      }
      const resume = () =>
        tr.el.play()
        .then(() => {
          tr.pausedAt = null;
          const t = this.ctx.currentTime;
          tr.trim.gain.cancelScheduledValues(t);
          tr.trim.gain.setValueAtTime(0.0001, t);
          tr.trim.gain.exponentialRampToValueAtTime(
            Math.max(0.0001, tr.trimBase * this.presentationGainScale),
            t + PAUSE_RAMP
          );
        })
        .catch((e) => {
          if ((e as DOMException).name !== "AbortError") console.warn("audio resume:", e);
        });
      void resume();
      setTimeout(() => {
        if (this.active === tr && tr.el.paused) void resume();
      }, 140);
    }
  }

  /** 跳转播放位置(秒;进度条/测试用) */
  seek(sec: number) {
    const el = this.active?.el;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
  }

  get playing() {
    return !!this.active && this.active.pausedAt === null && !this.active.el.paused;
  }

  get looping() {
    return !!this.active?.el.loop;
  }

  /** 当前曲目进度(面板进度条/会话弧线用);metadata 未就绪时 null */
  get track(): { t: number; dur: number } | null {
    const el = this.active?.el;
    if (!el || !isFinite(el.duration) || el.duration <= 0) return null;
    return { t: el.currentTime, dur: el.duration };
  }

  /** 距自然曲终秒数(无曲/loop 曲返回 Infinity) */
  remaining(): number {
    const el = this.active?.el;
    if (!el || el.loop || !isFinite(el.duration) || el.duration <= 0) return Infinity;
    return Math.max(0, el.duration - el.currentTime);
  }

  /** 测试钩子:把当前曲目推进到自然曲终后的姿态,再触发 onEnded。 */
  simulateEnded() {
    const el = this.active?.el;
    if (!el) return;
    if (el.loop) {
      try {
        el.currentTime = 0;
      } catch {
        // Some media elements reject synthetic seeks; loop mode still must not emit ended.
      }
      return;
    }
    el.pause();
    if (isFinite(el.duration) && el.duration > 0) {
      try {
        el.currentTime = el.duration;
      } catch {
        // Some browsers reject seeking on ended/unbuffered media; paused state is enough for tests.
      }
    }
    this.onEnded?.();
  }

  /** 每帧调用:更新分频并平滑 */
  update() {
    this.analyser.getByteFrequencyData(this.fft);
    const bin = this.ctx.sampleRate / this.analyser.fftSize; // Hz/bin
    const avg = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / bin));
      const b = Math.min(this.fft.length - 1, Math.ceil(hi / bin));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.fft[i];
      return s / ((b - a + 1) * 255);
    };
    const raw = {
      low: avg(25, 250),
      mid: avg(250, 2000),
      high: avg(2000, 9000),
      energy: avg(25, 9000)
    };
    for (const k of ["low", "mid", "high", "energy"] as const) {
      const cur = this.smoothed[k];
      const target = raw[k];
      this.smoothed[k] = cur + (target - cur) * (target > cur ? ATTACK : DECAY);
      this.bands[k] = this.smoothed[k];
    }
  }

  // --- BeatClock ---
  get beatDuration() {
    return this.active ? 60 / this.active.bpm : 60 / 90;
  }

  /** 当前拍(浮点,含小数进度);无曲目时按墙钟 */
  get beatFloat() {
    if (!this.active) return 0;
    return Math.max(0, (this.active.el.currentTime - this.active.offsetSec) / this.beatDuration);
  }

  get barFloat() {
    return this.beatFloat / 4;
  }

  /** 距下一小节边界的秒数 */
  secondsToNextBar(): number {
    const bar = this.barFloat;
    const next = Math.ceil(bar + 1e-4);
    return (next - bar) * this.beatDuration * 4;
  }
}
