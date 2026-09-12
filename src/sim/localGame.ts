import { createGame, EngineError, reduce, type Action, type GameState, type Role, type Seat } from "@/engine";
import { botActions } from "./bots";
import { botDelay, buildSeats, DURATION, phaseKeyOf, readMs, type SeatMeta } from "./timing";

export type { SeatMeta };

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

// 本機模擬：在瀏覽器裡跑引擎，擔任「伺服器」角色（計時、驅動 AI）。
// 之後換成 Convex 時，UI 只需改為訂閱伺服器上的 viewFor 結果。
export class LocalGame {
  // 戰績用的對局 id，避免同一局重複記錄
  readonly id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    // 上一局自己的角色：重新發牌最多 6 次，避免連續抽到同一個角色
    avoidRole?: Role,
  ) {
    this.userSeat = 1 + Math.floor(Math.random() * 12);
    this.state = createGame({ seed: Math.floor(Math.random() * 2 ** 32) });
    for (let attempt = 0; attempt < 6 && avoidRole && this.state.players[this.userSeat - 1].role === avoidRole; attempt++) {
      this.state = createGame({ seed: Math.floor(Math.random() * 2 ** 32) });
    }
    this.meta = buildSeats(new Map([[this.userSeat, nickname]]));
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
    const key = phaseKeyOf(this.state);
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

  // 發言交給 LLM：拿到內容就先顯示並朗讀，依字數停留（readMs，配合朗讀速度）且念完才換下一位。
  // 這讓玩家聽得完，也把呼叫頻率壓在 Groq 每分鐘 token 額度內。等待期間階段若已改變就放棄這次結果。
  private speakWithAI(m: SeatMeta, fallback: Action[]) {
    const key = this.phaseKey;
    const names = this.meta.map((x) => x.name);
    const canned = fallback.find((a) => a.type === "say");
    void this.speech!(this.state, m.seat, names, m.style ?? "").then((text) => {
      if (this.destroyed || this.phaseKey !== key) return;
      const content = text ?? (canned?.type === "say" ? canned.text : "");
      this.dispatch({ type: "say", seat: m.seat, text: content });
      const wait = readMs(content) / this.speed;
      // 開啟朗讀時等念完才換下一位；加速觀戰時不朗讀。階段若已改變（計時器被清掉）就不再結束發言
      const reading = this.narrator && this.speed === 1 ? this.narrator(m.seat, content, m.voice) : Promise.resolve();
      const minWait = new Promise<void>((resolve) => this.timers.push(setTimeout(resolve, wait)));
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
