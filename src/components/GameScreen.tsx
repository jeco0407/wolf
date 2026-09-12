"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { recordGame } from "@/lib/stats";
import { playBgm, playSfx, say, unlockAudio } from "@/voice/audio";
import { Avatar } from "@/components/Avatar";
import { ChatLog } from "@/components/ChatLog";
import { DawnOverlay, DeadOverlay } from "@/components/Overlays";
import { RoleCard } from "@/components/RoleCard";
import { SceneBackground } from "@/components/SceneBackground";
import { SeatGrid, type SeatPlayer } from "@/components/SeatGrid";
import {
  ROLE_NAME,
  teamOf,
  type Action,
  type GameEvent,
  type GameView,
  type InteractiveStep,
  type NightStep,
  type Role,
  type Seat,
} from "@/engine";
import type { SeatMeta } from "@/sim/timing";
import { narrate } from "@/sim/narrate";
import type { VoiceState } from "@/voice/livekit";
import { listen, type Listener } from "@/voice/stt";

const NIGHT_TEXT: Record<NightStep, string> = {
  guard: "天黑請閉眼・守衛請睜眼，選擇今晚要守護的人…",
  wolf: "天黑請閉眼・狼人請睜眼，商量今晚要刀誰…",
  witch: "天黑請閉眼・女巫請睜眼，決定是否用藥…",
  seer: "天黑請閉眼・預言家請睜眼，選擇要查驗的人…",
};
const STEP_ROLE: Record<NightStep, Role> = { guard: "guard", wolf: "werewolf", witch: "witch", seer: "seer" };
const DEATH_TEXT = {
  wolf: "昨晚你被狼人殺害。",
  poison: "昨晚你被女巫毒殺。",
  vote: "你被大家投票放逐了。",
  shot: "你被獵人開槍帶走了。",
} as const;

function phaseLabel(p: InteractiveStep): string {
  switch (p.kind) {
    case "night":
      return `${ROLE_NAME[STEP_ROLE[p.step]]}行動`;
    case "speech":
      return p.pk ? "PK 發言" : "白天發言";
    case "lastWords":
      return "遺言";
    case "vote":
      return p.pk ? "PK 投票" : "投票";
    case "hunter":
      return "獵人開槍";
    case "ended":
      return "遊戲結束";
  }
}

// 遊戲主畫面：本機模擬（/play）與連線對局（/game/[code]）共用，資料來源由 GameController 提供
export interface GameController {
  // 對局 id（戰績去重用）
  id: string;
  // 自己的視角（viewFor 過濾後）
  view: GameView;
  meta: SeatMeta[];
  deadline: number | null;
  // 這輪投票自己是否已經投過
  voted: boolean;
  // 身份揭曉後才算開始（開始前的事件不播音效）
  started: boolean;
  start: () => void;
  // 回傳錯誤訊息（不合法的行動），成功則回傳 null
  dispatch: (action: Action) => string | null | Promise<string | null>;
  // 觀戰加速（只有本機模擬支援）
  speed?: number;
  setSpeed?: (speed: number) => void;
  // 即時語音（只有連線對局、至少兩位真人時）：全體頻道與狼隊頻道
  voice?: { main: VoiceState; wolves: VoiceState };
  // 由畫面朗讀 AI 發言（連線對局用；本機模擬由 LocalGame 的 Narrator 朗讀，避免念兩次）
  readAiSpeech?: boolean;
}

export function GameScreen({ game, onRestart }: { game: GameController; onRestart: () => void }) {
  const view = game.view;
  const messages = useMemo(() => narrate(view, game.meta), [view, game.meta]);

  const [sel, setSel] = useState<{ key: string; seat: Seat } | null>(null);
  const [note, setNote] = useState<{ key: string; text: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const listener = useRef<Listener | null>(null);
  const [seenDawns, setSeenDawns] = useState(0);
  const [deathSeen, setDeathSeen] = useState(false);

  const me = view.you!;
  const phase = view.phase;
  const key = `${view.day}:${JSON.stringify(phase)}`;
  const selected = sel?.key === key ? sel.seat : null;
  const noteText = note?.key === key ? note.text : null;
  const name = (seat: Seat) => `${seat} 號 ${game.meta[seat - 1].name}`;

  // 聲音：階段切換時換背景音樂、播法官台詞
  const lastKey = useRef("");
  useEffect(() => {
    if (!game.started || key === lastKey.current) return;
    lastKey.current = key;
    void playBgm(phase.kind === "night" ? "night" : phase.kind === "ended" ? "result" : "day");
    if (phase.kind !== "night") return;
    if (phase.step === "guard") {
      void playSfx("night");
      void say("天黑請閉眼。守衛請睜眼。", { kind: "judge" });
    } else {
      if (phase.step === "wolf") void playSfx("howl");
      void say(`${ROLE_NAME[STEP_ROLE[phase.step]]}請睜眼。`, { kind: "judge" });
    }
  }, [key, phase, game.started]);

  // 聲音：新的公開事件的音效與播報；開始前的事件不播。
  // 只數公開事件：出局後改成上帝視角時，私密事件會插進列表中間，不能拿總數當進度
  const publicEvents = useMemo(() => view.events.filter((e) => e.to === "all"), [view.events]);
  const heard = useRef(0);
  useEffect(() => {
    if (game.started) {
      for (const e of publicEvents.slice(heard.current)) {
        announce(e, teamOf(me.role));
        // AI 發言用各自人設的聲音念出來；真人的發言大家已經透過語音聽到了，不再念
        const speaker = e.type === "speech" ? game.meta[e.seat - 1] : undefined;
        if (e.type === "speech" && game.readAiSpeech && speaker && !speaker.isUser) void say(e.text, { kind: "ai", voice: speaker.voice });
      }
    }
    heard.current = publicEvents.length;
  }, [publicEvents, game.started, game.readAiSpeech, game.meta, me.role]);

  // 自己出局時的音效（死因是私密資訊，只看自己的存活狀態）
  const wasAlive = useRef(me.alive);
  useEffect(() => {
    if (game.started && wasAlive.current && !me.alive) void playSfx("death");
    wasAlive.current = me.alive;
  }, [me.alive, game.started]);

  // 遊戲結束時寫入戰績（同一局只記一次）
  useEffect(() => {
    if (!game.started || phase.kind !== "ended") return;
    recordGame({ id: game.id, role: me.role, winner: phase.winner, survived: me.alive, days: view.day });
  }, [game.started, game.id, phase, me.role, me.alive, view.day]);

  // 換階段（輪到別人、天亮天黑）時停止語音轉文字；伺服器也會同時收回 LiveKit 的發言權限
  useEffect(
    () => () => {
      listener.current?.stop();
      listener.current = null;
    },
    [key],
  );

  // 離開頁面時停止背景音樂
  useEffect(
    () => () => {
      void playBgm(null);
    },
    [],
  );

  if (!game.started) {
    return (
      <Shell isNight>
        <Reveal
          role={me.role}
          onDone={() => {
            unlockAudio();
            game.start();
          }}
        />
      </Shell>
    );
  }

  if (phase.kind === "ended") {
    return (
      <Shell isNight={phase.winner === "wolf"}>
        <Result view={view} meta={game.meta} winner={phase.winner} onRestart={onRestart} />
      </Shell>
    );
  }

  const act = async (action: Action, done?: string) => {
    const err = await game.dispatch(action);
    setNote(err ? { key, text: `⚠️ ${err}` } : done ? { key, text: done } : null);
    if (!err) setSel(null);
  };
  const endSpeech = async () => {
    listener.current?.stop();
    void game.voice?.main.setMic(false);
    if (draft.trim()) await game.dispatch({ type: "say", seat: me.seat, text: draft.trim() });
    setDraft("");
    await act({ type: "endSpeech", seat: me.seat });
  };
  // 麥克風：有即時語音時同時開 LiveKit（大家聽得到）與語音轉文字（寫進發言，AI 才看得懂）
  const voiceMain = game.voice?.main;
  const toggleMic = async () => {
    if (listening || voiceMain?.micOn) {
      listener.current?.stop();
      listener.current = null;
      setListening(false);
      await voiceMain?.setMic(false);
      return;
    }
    if (voiceMain?.canTalk) await voiceMain.setMic(true);
    const l = listen(
      (text) => setDraft((d) => d + text),
      () => {
        listener.current = null;
        setListening(false);
      },
    );
    if (l) {
      listener.current = l;
      setListening(true);
    } else {
      setNote({
        key,
        text: voiceMain?.canTalk ? "⚠️ 此瀏覽器不支援語音轉文字：大家聽得到你，但 AI 看不到，請補打重點" : "⚠️ 此瀏覽器不支援語音輸入，請改用打字",
      });
    }
  };
  const micActive = listening || !!voiceMain?.micOn;

  const alive = view.players.filter((p) => p.alive).map((p) => p.seat);
  const others = alive.filter((s) => s !== me.seat);
  const pickLabel = (verb: string, fallback: string) => (selected ? `${verb} ${selected} 號` : fallback);

  // 依目前階段決定：可選的座位、提示文字、操作按鈕
  let allowed: Seat[] = [];
  let hint: string | null = null;
  let controls: ReactNode = null;

  switch (phase.kind) {
    case "night": {
      if (!me.alive || me.role !== STEP_ROLE[phase.step]) {
        hint = NIGHT_TEXT[phase.step];
        break;
      }
      if (phase.step === "guard") {
        allowed = alive.filter((s) => s !== view.lastGuard);
        hint = "選擇今晚要守護的人（不可連續兩晚守同一人）";
        controls = (
          <Row>
            <Btn ghost onClick={() => act({ type: "guard", seat: me.seat, target: null }, "今晚空守")}>
              空守
            </Btn>
            <Btn disabled={!selected} onClick={() => act({ type: "guard", seat: me.seat, target: selected }, `已選擇守護 ${selected} 號，時間到前可以改選`)}>
              {pickLabel("🛡️ 守護", "選擇要守護的人")}
            </Btn>
          </Row>
        );
      } else if (phase.step === "wolf") {
        allowed = alive;
        hint = "和狼隊友商量，時間到時票數最高者被刀";
        controls = (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="跟狼隊友說…"
                className="h-11 min-w-0 flex-1 rounded-xl bg-night/70 px-3 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (!draft.trim()) return;
                  act({ type: "wolfChat", seat: me.seat, text: draft.trim() });
                  setDraft("");
                }}
                className="h-11 rounded-xl bg-panel-2 px-4 text-sm"
              >
                送出
              </button>
            </div>
            {game.voice?.wolves.canTalk && (
              <Btn ghost onClick={() => void game.voice!.wolves.setMic(!game.voice!.wolves.micOn)}>
                {game.voice.wolves.micOn ? "🔴 狼隊語音中（點一下閉麥）" : "🎙️ 開麥和狼隊友說話"}
              </Btn>
            )}
            <Btn disabled={!selected} onClick={() => act({ type: "wolfVote", seat: me.seat, target: selected }, `你投刀 ${selected} 號，時間到前可以改投`)}>
              {pickLabel("🗡️ 投刀", "選擇要刀的人")}
            </Btn>
          </div>
        );
      } else if (phase.step === "witch") {
        const info = view.events.findLast((e) => e.type === "witchInfo" && e.day === view.day);
        const knife = info?.type === "witchInfo" ? info.target : null;
        const potions = view.potions!;
        const canSave = potions.antidote && knife !== null && (knife !== me.seat || view.day === 1);
        allowed = potions.poison ? others : [];
        hint = !potions.antidote ? "解藥已用完，看不到刀口" : knife === null ? "今晚沒有人被刀" : `今晚被刀的是 ${name(knife)}`;
        controls = (
          <Row cols={3}>
            <Btn tone="good" disabled={!canSave} onClick={() => act({ type: "witch", seat: me.seat, use: "save" }, "已使用解藥")}>
              🧪 救他
            </Btn>
            <Btn
              tone="wolf"
              disabled={!selected || !potions.poison}
              onClick={() => act({ type: "witch", seat: me.seat, use: "poison", target: selected! }, `已毒 ${selected} 號`)}
            >
              {selected ? `☠️ 毒 ${selected} 號` : "☠️ 毒藥"}
            </Btn>
            <Btn ghost onClick={() => act({ type: "witch", seat: me.seat, use: "none" }, "今晚不用藥")}>
              不用藥
            </Btn>
          </Row>
        );
      } else {
        allowed = others;
        hint = "選擇要查驗的人，結果會顯示在紀錄中";
        controls = (
          <Btn disabled={!selected} onClick={() => act({ type: "seerCheck", seat: me.seat, target: selected! }, "查驗完成")}>
            {pickLabel("🔮 查驗", "選擇要查驗的人")}
          </Btn>
        );
      }
      break;
    }

    case "speech":
    case "lastWords": {
      if (phase.seat === me.seat) {
        hint = phase.kind === "lastWords" ? "請發表遺言" : phase.pk ? "PK 發言：說服大家不要投你" : "輪到你發言";
        controls = (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="說點什麼…"
                className="min-h-12 flex-1 resize-none rounded-xl bg-night/70 px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => void toggleMic()}
                className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${micActive ? "speaking bg-blood" : "bg-panel-2"}`}
                aria-label={micActive ? "關閉麥克風" : voiceMain?.canTalk ? "開麥發言" : "語音輸入"}
              >
                🎙️
              </button>
            </div>
            <Btn onClick={endSpeech}>結束發言</Btn>
          </div>
        );
      } else {
        hint = `${name(phase.seat)} ${phase.kind === "lastWords" ? "正在發表遺言" : "正在發言"}…`;
      }
      break;
    }

    case "vote": {
      const eligible = me.alive && !phase.candidates?.includes(me.seat);
      const voted = game.voted;
      if (eligible && !voted) {
        allowed = (phase.candidates ?? others).filter((s) => s !== me.seat);
        hint = phase.pk ? "PK 投票：只能投給台上的玩家" : "投票放逐一名玩家";
        controls = (
          <Row>
            <Btn ghost onClick={() => act({ type: "vote", seat: me.seat, target: null })}>
              棄票
            </Btn>
            <Btn disabled={!selected} onClick={() => act({ type: "vote", seat: me.seat, target: selected })}>
              {pickLabel("投給", "選擇要放逐的人")}
            </Btn>
          </Row>
        );
      } else {
        hint = eligible ? "已投票，等待其他人…" : "你這輪不能投票，等待結果…";
      }
      break;
    }

    case "hunter": {
      if (phase.seat === me.seat) {
        allowed = others;
        hint = "你出局了，可以開槍帶走一人";
        controls = (
          <Row>
            <Btn ghost onClick={() => act({ type: "shoot", seat: me.seat, target: null })}>
              不開槍
            </Btn>
            <Btn disabled={!selected} onClick={() => act({ type: "shoot", seat: me.seat, target: selected })}>
              {pickLabel("🏹 帶走", "選擇目標")}
            </Btn>
          </Row>
        );
      } else {
        hint = `${name(phase.seat)} 正在決定是否開槍…`;
      }
      break;
    }
  }

  const myTurn = controls !== null;
  if (!me.alive && controls === null) {
    controls = game.setSpeed ? (
      <SpeedBar speed={game.speed ?? 1} onChange={game.setSpeed} />
    ) : (
      <p className="py-1 text-center text-sm text-gold">👁️ 上帝視角觀戰中</p>
    );
  }

  const players: SeatPlayer[] = view.players.map((p) => ({
    seat: p.seat,
    name: game.meta[p.seat - 1].name,
    avatar: game.meta[p.seat - 1].avatar,
    alive: p.alive,
    role: p.role,
    isUser: p.seat === me.seat,
  }));

  const dawns = view.events.flatMap((e) => (e.type === "dawn" ? [e] : []));
  const lastDawn = dawns.at(-1);
  const showDawn = !!lastDawn && dawns.length > seenDawns;
  const myDeath = view.events.flatMap((e) => (e.type === "death" && e.seat === me.seat ? [e] : []))[0];
  const showDeath = !me.alive && !deathSeen && !showDawn;

  return (
    <Shell isNight={phase.kind === "night"}>
      <header className="pt-safe flex items-center justify-between px-4 pb-2">
        <Link href="/" className="w-10 text-sm text-mist">
          ✕
        </Link>
        <div className="text-center">
          <div className="font-serif text-lg font-black tracking-widest drop-shadow-[0_1px_6px_rgba(0,0,0,0.95)]">
            {phase.kind === "night" ? `🌙 第 ${view.day} 夜` : `☀️ 第 ${view.day} 天`}
          </div>
          <div className="text-[11px] text-mist">
            {phaseLabel(phase)}
            {view.omniscient && " · 上帝視角"}
          </div>
        </div>
        <Countdown deadline={game.deadline} tick={myTurn} />
      </header>

      <SeatGrid
        players={players}
        speakingSeat={phase.kind === "speech" || phase.kind === "lastWords" ? phase.seat : undefined}
        revealAll
        selectable={(p) => allowed.includes(p.seat)}
        selected={selected}
        onSelect={(seat) => setSel({ key, seat })}
      />

      <section className="mt-2 min-h-0 flex-1 overflow-y-auto">
        <ChatLog messages={messages} players={game.meta} />
      </section>

      <footer className="panel pb-safe space-y-2 rounded-t-2xl border-b-0 px-3 pt-3">
        {(game.voice?.main.needsUnlock || game.voice?.wolves.needsUnlock) && (
          <button
            type="button"
            onClick={() => {
              game.voice?.main.unlock();
              game.voice?.wolves.unlock();
            }}
            className="w-full rounded-lg bg-gold/20 py-2 text-sm text-gold"
          >
            🔊 點此收聽其他玩家的語音
          </button>
        )}
        {hint && <p className="text-center text-sm text-moon/85">{hint}</p>}
        {noteText && <p className="text-center text-xs text-gold">{noteText}</p>}
        {controls}
      </footer>

      {showDawn && (
        <DawnOverlay onDone={() => setSeenDawns(dawns.length)}>
          {lastDawn.deaths.length ? (
            <>
              昨晚死亡的是 <b className="text-blood">{lastDawn.deaths.map(name).join("、")}</b>
            </>
          ) : (
            "昨晚是平安夜"
          )}
        </DawnOverlay>
      )}
      {showDeath && (
        <DeadOverlay
          message={`${myDeath ? DEATH_TEXT[myDeath.cause] : ""}你可以用上帝視角繼續觀看，但不能再發言。`}
          onDone={() => setDeathSeen(true)}
        />
      )}
    </Shell>
  );
}

// 公開事件的音效與法官播報；私密事件只播自己出局的音效
function announce(e: GameEvent, myTeam: "good" | "wolf") {
  const judge = { kind: "judge" as const };
  switch (e.type) {
    case "dawn":
      void playSfx("bell");
      void say(e.deaths.length ? `天亮了。昨晚死亡的是${e.deaths.map((s) => `${s}號`).join("、")}。` : "天亮了。昨晚是平安夜。", judge);
      break;
    case "vote":
      void playSfx("vote");
      void say(
        e.exiled !== null ? `投票結束，${e.exiled}號被放逐。` : e.tie.length > 1 && !e.pk ? `${e.tie.join("、")}號平票，進入PK。` : "今天無人出局。",
        judge,
      );
      break;
    case "shot":
      if (e.target === null) break;
      void playSfx("gunshot");
      void say(`${e.seat}號開槍帶走了${e.target}號。`, judge);
      break;
    case "gameOver":
      void playSfx(e.winner === myTeam ? "win" : "lose");
      void say(`遊戲結束，${e.winner === "good" ? "好人" : "狼人"}勝利。`, judge);
      break;
  }
}

function Shell({ isNight, children }: { isNight: boolean; children: ReactNode }) {
  return (
    <main className="relative isolate flex h-dvh flex-col">
      <SceneBackground isNight={isNight} />
      {children}
    </main>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  ghost,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ghost?: boolean;
  tone?: "good" | "wolf";
}) {
  const look = ghost ? "bg-panel-2" : tone === "good" ? "bg-good/70" : tone === "wolf" ? "bg-wolf/80" : "btn-primary font-bold";
  return (
    <button
      type="button"
      onClick={() => {
        void playSfx("click");
        onClick();
      }}
      disabled={disabled}
      className={`h-12 w-full rounded-xl px-3 text-sm disabled:opacity-40 ${look}`}
    >
      {children}
    </button>
  );
}

function Row({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-2 ${cols === 3 ? "grid-cols-3" : "grid-cols-[1fr_2fr]"}`}>{children}</div>;
}

function Countdown({ deadline, tick }: { deadline: number | null; tick: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, []);
  const seconds = deadline && now ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  // 輪到自己時，最後 5 秒滴答提醒
  useEffect(() => {
    if (tick && seconds !== null && seconds > 0 && seconds <= 5) void playSfx("tick");
  }, [tick, seconds]);
  return (
    <div className={`w-10 text-right font-mono text-sm ${seconds !== null && seconds <= 10 ? "text-blood" : "text-gold"}`}>
      {seconds !== null ? `${seconds}s` : ""}
    </div>
  );
}

function SpeedBar({ speed, onChange }: { speed: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gold">👁️ 上帝視角觀戰中</span>
      <div className="flex gap-1.5">
        {[1, 2, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-9 rounded-lg px-3 text-xs ${speed === n ? "bg-gold font-bold text-night" : "bg-panel-2"}`}
          >
            {n}×
          </button>
        ))}
      </div>
    </div>
  );
}

function Reveal({ role, onDone }: { role: Role; onDone: () => void }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-safe">
      <p className="mb-4 text-sm tracking-[0.3em] text-mist">{flipped ? "你的身份是" : "點擊卡片翻開你的身份"}</p>
      <div className="w-full max-w-[280px]">
        <RoleCard
          role={role}
          flipped={flipped}
          onFlip={() => {
            unlockAudio();
            void playSfx("flip");
            setFlipped(true);
          }}
        />
      </div>
      <div className={`mt-5 w-full max-w-[280px] text-center transition-opacity duration-500 ${flipped ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <button onClick={onDone} className="btn-primary h-12 w-full rounded-xl font-bold tracking-widest">
          我記住了，開始遊戲
        </button>
      </div>
    </div>
  );
}

function Result({ view, meta, winner, onRestart }: { view: GameView; meta: SeatMeta[]; winner: "good" | "wolf"; onRestart: () => void }) {
  const me = view.you!;
  const won = teamOf(me.role) === winner;
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-safe">
      <div className="fade-in relative -mx-4 mb-4 aspect-[4/3]">
        <Image src={`/scenes/${winner}-win.jpeg`} alt="" fill priority sizes="(max-width: 480px) 100vw, 480px" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 pb-3 text-center">
          <p className="text-sm tracking-[0.3em] text-mist">遊戲結束・第 {view.day} 天</p>
          <h2
            className={`mt-1 font-serif text-4xl font-black tracking-widest drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ${winner === "good" ? "text-good" : "text-wolf"}`}
          >
            {winner === "good" ? "好人勝利" : "狼人勝利"}
          </h2>
          <p className="mt-1 text-sm text-gold">
            你以{ROLE_NAME[me.role]}身份{won ? "獲勝 🎉" : "落敗"}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {view.players.map((p) => (
          <div key={p.seat} className={`panel flex items-center gap-2 rounded-xl px-3 py-2 ${p.alive ? "" : "opacity-60"}`}>
            <Avatar src={meta[p.seat - 1].avatar} size={28} alt={meta[p.seat - 1].name} />
            <span className="min-w-0 flex-1 truncate text-sm">
              {p.seat}. {meta[p.seat - 1].name}
            </span>
            {p.role && (
              <span className={`rounded px-1.5 text-[11px] ${teamOf(p.role) === "wolf" ? "bg-wolf/80" : "bg-good/70"}`}>{ROLE_NAME[p.role]}</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 pb-4">
        <Link href="/" className="panel flex h-12 items-center justify-center rounded-xl text-sm">
          回首頁
        </Link>
        <button type="button" onClick={onRestart} className="btn-primary h-12 rounded-xl text-sm font-bold">
          再來一局
        </button>
      </div>
    </div>
  );
}
