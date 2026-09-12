// 遊戲聲音：音效、背景音樂、語音朗讀（法官／AI）。只在瀏覽器端使用。
// 音檔放在 public/sounds/（音效 `<名稱>.mp3`、背景音樂 `bgm-<場景>.mp3`）；找不到音檔時，音效改用 Web Audio 合成，背景音樂則靜音。

export type Sfx = "click" | "tick" | "flip" | "night" | "howl" | "bell" | "vote" | "death" | "gunshot" | "win" | "lose";
export type Bgm = "night" | "day" | "result";

export interface AudioSettings {
  judgeVoice: boolean;
  aiVoice: boolean;
  sfx: boolean;
  bgm: boolean;
  volume: number;
}

const DEFAULTS: AudioSettings = { judgeVoice: true, aiVoice: true, sfx: true, bgm: true, volume: 0.8 };
const STORAGE_KEY = "ww:audio";

// ---- 設定（useSyncExternalStore 相容的小型 store） ----
let settings: AudioSettings | null = null;
const listeners = new Set<() => void>();

export function getAudioSettings(): AudioSettings {
  if (!settings) {
    try {
      settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
    } catch {
      settings = DEFAULTS;
    }
  }
  return settings!;
}

export const getServerAudioSettings = () => DEFAULTS;

export function subscribeAudioSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateAudioSettings(patch: Partial<AudioSettings>) {
  settings = { ...getAudioSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
  listeners.forEach((l) => l());
  if (patch.bgm === false) void playBgm(null);
  if (patch.volume !== undefined && bgmEl) bgmEl.volume = settings.volume * BGM_LEVEL;
}

// ---- 解鎖（iOS 需在使用者點擊時呼叫一次） ----
let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  ctx ??= new AudioContext();
  void ctx.resume();
  if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}

// ---- 音檔偵測：有檔案就用檔案 ----
const available = new Map<string, Promise<boolean>>();

function hasFile(path: string): Promise<boolean> {
  let p = available.get(path);
  if (!p) {
    p = fetch(path, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false);
    available.set(path, p);
  }
  return p;
}

// ---- 音效 ----
export async function playSfx(name: Sfx) {
  if (typeof window === "undefined") return;
  const s = getAudioSettings();
  if (!s.sfx) return;
  const path = `/sounds/${name}.mp3`;
  if (await hasFile(path)) {
    const a = new Audio(path);
    a.volume = s.volume;
    void a.play().catch(() => {});
    return;
  }
  synth(name, s.volume);
}

function synth(name: Sfx, volume: number) {
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime;
  const out = c.createGain();
  out.gain.value = volume * 0.6;
  out.connect(c.destination);

  const tone = (freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.5, endFreq?: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t + start);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + start + dur);
    g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(gain, t + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g).connect(out);
    o.start(t + start);
    o.stop(t + start + dur + 0.05);
  };

  const noise = (start: number, dur: number, cutoff: number, gain: number) => {
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const g = c.createGain();
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    g.gain.setValueAtTime(gain, t + start);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t + start);
  };

  switch (name) {
    case "click":
      tone(900, 0, 0.05, "triangle", 0.25);
      break;
    case "tick":
      tone(1400, 0, 0.04, "square", 0.12);
      break;
    case "flip":
      noise(0, 0.25, 3000, 0.35);
      tone(300, 0, 0.2, "sine", 0.2, 700);
      break;
    case "vote":
      tone(660, 0, 0.12, "triangle", 0.35);
      tone(880, 0.08, 0.2, "triangle", 0.3);
      break;
    case "bell":
      for (const k of [0, 0.9]) {
        tone(523.25, k, 2.2, "sine", 0.45);
        tone(1046.5, k, 1.6, "sine", 0.15);
        tone(1567.98, k, 1.0, "sine", 0.08);
      }
      break;
    case "night":
      tone(110, 0, 2.5, "sine", 0.35, 82);
      tone(165, 0.2, 2.3, "sine", 0.15, 123);
      break;
    case "howl": {
      const o = c.createOscillator();
      const g = c.createGain();
      const lfo = c.createOscillator();
      const depth = c.createGain();
      const filter = c.createBiquadFilter();
      o.type = "triangle";
      o.frequency.setValueAtTime(300, t);
      o.frequency.linearRampToValueAtTime(620, t + 0.6);
      o.frequency.linearRampToValueAtTime(560, t + 1.8);
      o.frequency.linearRampToValueAtTime(380, t + 2.4);
      lfo.frequency.value = 6;
      depth.gain.value = 12;
      lfo.connect(depth).connect(o.frequency);
      filter.type = "lowpass";
      filter.frequency.value = 1500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.3);
      g.gain.linearRampToValueAtTime(0.3, t + 1.9);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.5);
      o.connect(filter).connect(g).connect(out);
      o.start(t);
      lfo.start(t);
      o.stop(t + 2.6);
      lfo.stop(t + 2.6);
      break;
    }
    case "death":
      tone(98, 0, 1.2, "sine", 0.6, 55);
      noise(0, 0.3, 400, 0.3);
      break;
    case "gunshot":
      noise(0, 0.35, 2500, 1);
      tone(150, 0, 0.2, "square", 0.2, 60);
      break;
    case "win":
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.15, 0.6, "triangle", 0.35));
      break;
    case "lose":
      [440, 392, 349.23, 293.66].forEach((f, i) => tone(f, i * 0.25, 0.8, "sine", 0.35));
      break;
  }
}

// ---- 背景音樂（沒有音檔就靜音） ----
const BGM_LEVEL = 0.35;
let bgmEl: HTMLAudioElement | null = null;
let bgmName: Bgm | null = null;

function fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = a.volume;
  const start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / ms);
    a.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

export async function playBgm(name: Bgm | null) {
  if (typeof window === "undefined") return;
  const s = getAudioSettings();
  const next = s.bgm ? name : null;
  if (next === bgmName) return;
  bgmName = next;
  const old = bgmEl;
  bgmEl = null;
  if (old) fade(old, 0, 800, () => old.pause());
  if (!next) return;
  const path = `/sounds/bgm-${next}.mp3`;
  if (!(await hasFile(path)) || bgmName !== next) return;
  const a = new Audio(path);
  a.loop = true;
  a.volume = 0;
  bgmEl = a;
  void a.play().catch(() => {});
  fade(a, s.volume * BGM_LEVEL, 1500);
}

// ---- 語音朗讀：法官與 AI 共用瀏覽器的朗讀佇列，依序念完 ----
function zhVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "zh-TW") ?? voices.find((v) => v.lang.startsWith("zh")) ?? null;
}

export function say(
  text: string,
  opts: { kind: "judge" | "ai"; voice?: { pitch: number; rate: number }; force?: boolean },
): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  const s = getAudioSettings();
  if (!opts.force && !(opts.kind === "judge" ? s.judgeVoice : s.aiVoice)) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-TW";
    u.voice = zhVoice();
    u.volume = s.volume;
    // 法官聲音低沉、稍慢；AI 用各自人設的音高與語速
    u.pitch = opts.voice?.pitch ?? 0.7;
    u.rate = opts.voice?.rate ?? 0.95;
    // 保險：某些瀏覽器不會觸發 onend。長發言約 40 秒，所以給到 60 秒
    const safety = setTimeout(resolve, 60000);
    u.onend = u.onerror = () => {
      clearTimeout(safety);
      resolve();
    };
    window.speechSynthesis.speak(u);
  });
}
