import { PERSONAS } from "@/ai/personas";
import { createGame, EngineError, reduce, type Action, type GameState, type InteractiveStep, type Seat } from "@/engine";
import { drawAvatars } from "@/lib/avatars";
import { botActions } from "./bots";

export interface SeatMeta {
  seat: Seat;
  name: string;
  avatar: string;
  isUser: boolean;
  style?: string;
  voice?: { pitch: number; rate: number };
}

export interface Snapshot {
  state: GameState;
  deadline: number | null;
  speed: number;
  started: boolean;
}

// 產生 AI 發言（例如呼叫 Groq）；回傳 null 時改用罐頭台詞
export type SpeechProvider = (s: GameState, seat: Seat, names: string[], style: string) => Promise<string | null>;

// 朗讀 AI 發言；念完時 resolve（關閉朗讀時立即 resolve）
export type Narrator = (seat: Seat, text: string, voice?: SeatMeta["voice"]) => Promise<void>;

// 各階段時限（毫秒）。夜晚每步固定時長，與角色死活無關，避免從等待時間推敲身份
const DURATION: Record<InteractiveStep["kind"], number> = {
  night: 6000,
  speech: 90000,
  lastWords: 60000,
  vote: 30000,
  hunter: 15000,
  ended: 0,
};

function botDelay(phase: InteractiveStep): number {
  if (phase.kind === "speech" || phase.kind === "lastWords") return 1800 + Math.random() * 1500;
  if (phase.kind === "vote") return 600 + Math.random() * 3000;
  return 800 + Math.random() * 2500;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 本機模擬：在瀏覽器裡跑引擎，擔任「伺服器」角色（計時、驅動 AI）。
// 之後換成 Convex 時，UI 只需改為訂閱伺服器上的 viewFor 結果。
export class LocalGame {
  readonly userSeat: Seat;
  readonly meta: SeatMeta[];
  private state: GameState;
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private phaseKey = "";
  private acted = new Set<Seat>();
  private deadline: number | null = null;
  private speed = 1;
  private started = false;
  private destroyed = false;

  constructor(
    nickname: string,
    private readonly speech?: SpeechProvider,
    private readonly narrator?: Narrator,
  ) {
    this.userSeat = 1 + Math.floor(Math.random() * 12);
    this.state = createGame({ seed: Math.floor(Math.random() * 2 ** 32) });
    const avatars = drawAvatars(12);
    const personas = shuffle(PERSONAS);
    this.meta = this.state.players.map((p, i) => {
      if (p.seat === this.userSeat) return { seat: p.seat, name: nickname, avatar: avatars[i], isUser: true };
      const persona = personas.pop()!;
      return {
        seat: p.seat,
        name: persona.name,
        style: persona.style,
        avatar: avatars[i],
        isUser: false,
        voice: { pitch: 0.7 + Math.random() * 0.7, rate: 0.95 + Math.random() * 0.3 },
      };
    });
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  // 身份揭曉後才開始計時
  start() {
    if (this.started) return;
    this.started = true;
    this.refresh(true);
  }

  // 觀戰加速：重設目前階段的計時與 AI 排程
  setSpeed(speed: number) {
    this.speed = speed;
    this.refresh(true);
  }

  destroy() {
    this.destroyed = true;
    this.clearTimers();
  }

  // React 開發模式會卸載後再掛載同一個實例；重新掛載時恢復計時與 AI 排程
  resume() {
    if (!this.destroyed) return;
    this.destroyed = false;
    if (this.started) this.refresh(true);
  }

  // 回傳錯誤訊息（不合法的行動），成功則回傳 null
  dispatch = (action: Action): string | null => {
    try {
      this.state = reduce(this.state, action);
    } catch (e) {
      if (e instanceof EngineError) return e.message;
      throw e;
    }
    this.refresh(false);
    return null;
  };

  private refresh(resetTimer: boolean) {
    const key = `${this.state.day}:${JSON.stringify(this.state.phase)}`;
    const phaseChanged = key !== this.phaseKey;
    if (phaseChanged || resetTimer) {
      this.phaseKey = key;
      this.acted.clear();
      this.clearTimers();
      this.deadline = null;
      const ms = DURATION[this.state.phase.kind] / this.speed;
      if (this.started && ms > 0) {
        this.deadline = Date.now() + ms;
        this.timers.push(setTimeout(() => this.dispatch({ type: "timeout" }), ms));
      }
    }
    if (this.started) this.scheduleBots();
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private scheduleBots() {
    const phase = this.state.phase;
    for (const m of this.meta) {
      if (m.isUser || this.acted.has(m.seat)) continue;
      const actions = botActions(this.state, m.seat);
      if (!actions.length) continue;
      this.acted.add(m.seat);
      const delay = botDelay(phase) / this.speed;

      const speaking = (phase.kind === "speech" || phase.kind === "lastWords") && phase.seat === m.seat;
      if (speaking && this.speech) {
        this.speakWithAI(m, actions);
        continue;
      }
      // 行動可能在觸發前就過期（例如階段已結束），此時引擎會拒絕，直接忽略即可
      this.timers.push(setTimeout(() => actions.forEach((a) => this.dispatch(a)), delay));
    }
  }

  // 發言交給 LLM：拿到內容就先顯示，再依字數停留（約每 10 字 1 秒，2.5–12 秒）才換下一位。
  // 這讓玩家讀得完，也把呼叫頻率壓在 Groq 每分鐘 token 額度內。等待期間階段若已改變就放棄這次結果。
  private speakWithAI(m: SeatMeta, fallback: Action[]) {
    const key = this.phaseKey;
    const names = this.meta.map((x) => x.name);
    const canned = fallback.find((a) => a.type === "say");
    void this.speech!(this.state, m.seat, names, m.style ?? "").then((text) => {
      if (this.destroyed || this.phaseKey !== key) return;
      const content = text ?? (canned?.type === "say" ? canned.text : "");
      this.dispatch({ type: "say", seat: m.seat, text: content });
      const readMs = Math.min(12000, Math.max(2500, content.length * 100)) / this.speed;
      // 開啟朗讀時等念完才換下一位；加速觀戰時不朗讀。階段若已改變（計時器被清掉）就不再結束發言
      const reading = this.narrator && this.speed === 1 ? this.narrator(m.seat, content, m.voice) : Promise.resolve();
      const minWait = new Promise<void>((resolve) => this.timers.push(setTimeout(resolve, readMs)));
      void Promise.all([minWait, reading]).then(() => {
        if (!this.destroyed && this.phaseKey === key) this.dispatch({ type: "endSpeech", seat: m.seat });
      });
    });
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private makeSnapshot(): Snapshot {
    return { state: this.state, deadline: this.deadline, speed: this.speed, started: this.started };
  }
}
