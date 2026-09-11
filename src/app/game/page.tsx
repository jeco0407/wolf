"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ChatLog } from "@/components/ChatLog";
import { DawnOverlay, DeadOverlay } from "@/components/Overlays";
import { RoleCard } from "@/components/RoleCard";
import { SceneBackground } from "@/components/SceneBackground";
import { SeatGrid } from "@/components/SeatGrid";
import { MESSAGES, PLAYERS, ROLE_INFO, type Message, type Role } from "@/lib/mock";

// 原型階段用切換器預覽各畫面；正式版由遊戲引擎驅動。
const PHASES = [
  { id: "reveal", label: "身份" },
  { id: "night-guard", label: "守衛" },
  { id: "night-wolf", label: "狼人" },
  { id: "night-witch", label: "女巫" },
  { id: "night-seer", label: "預言" },
  { id: "dawn", label: "天亮" },
  { id: "day", label: "發言" },
  { id: "vote", label: "投票" },
  { id: "dead", label: "出局" },
  { id: "god", label: "觀戰" },
  { id: "result", label: "結算" },
  { id: "result-wolf", label: "狼勝" },
] as const;
type Phase = (typeof PHASES)[number]["id"];

const WOLF_CHAT: Message[] = [
  { kind: "judge", text: "狼人請睜眼。你的隊友：3、10、11 號。" },
  { kind: "speech", seat: 11, text: "今晚刀 2 號，他坐姿像預言家。" },
  { kind: "speech", seat: 3, text: "同意，但女巫可能會救，要不要刀 8 號？" },
];

export default function GamePage() {
  const [phase, setPhase] = useState<Phase>("reveal");
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [timeLeft, setTimeLeft] = useState(90);
  const [listening, setListening] = useState(false);
  const isNight = phase.startsWith("night") || phase === "reveal" || phase === "dead" || phase === "result-wolf";

  const goTo = (p: Phase) => {
    setPhase(p);
    setSelected(null);
    setTimeLeft(90);
  };

  useEffect(() => {
    if (phase !== "day") return;
    const t = setInterval(() => setTimeLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const startListening = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return alert("此瀏覽器不支援語音輸入");
    const r = new SR();
    r.lang = "zh-TW";
    r.onresult = (e) => setDraft((d) => d + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  const me = PLAYERS.find((p) => p.isUser)!;
  const aliveOthers = (p: { alive: boolean }) => p.alive;

  return (
    <main className="relative isolate flex h-dvh flex-col">
      <SceneBackground isNight={isNight} />
      {/* 頂部 */}
      <header className="pt-safe flex items-center justify-between px-4 pb-2">
        <Link href="/" className="text-mist text-sm">
          ✕
        </Link>
        <div className="text-center">
          <div className="font-serif text-lg font-black tracking-widest drop-shadow-[0_1px_6px_rgba(0,0,0,0.95)]">{isNight ? "🌙 第 2 夜" : "☀️ 第 2 天"}</div>
          <div className="text-[11px] text-mist">{PHASES.find((p) => p.id === phase)?.label}階段</div>
        </div>
        <div className={`min-w-10 text-right font-mono text-sm ${timeLeft <= 10 ? "text-blood" : "text-gold"}`}>
          {phase === "day" ? `${timeLeft}s` : ""}
        </div>
      </header>

      {/* 原型用階段切換 */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-[11px]">
        {PHASES.map((p) => (
          <button
            key={p.id}
            onClick={() => goTo(p.id)}
            className={`shrink-0 rounded-full px-2.5 py-1 ${phase === p.id ? "bg-gold text-night font-bold" : "bg-panel-2 text-mist"}`}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {phase === "reveal" ? (
        <RoleReveal role={me.role} onDone={() => goTo("night-guard")} />
      ) : phase === "result" || phase === "result-wolf" ? (
        <Result winner={phase === "result-wolf" ? "wolf" : "good"} />
      ) : (
        <>
          <SeatGrid
            players={PLAYERS}
            speakingSeat={phase === "day" ? 9 : undefined}
            revealAll={phase === "god"}
            wolfTeammates={phase === "night-wolf"}
            selectable={phase === "vote" || phase === "night-witch" ? aliveOthers : undefined}
            selected={selected}
            onSelect={setSelected}
          />

          <section className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {phase === "night-wolf" ? (
              <ChatLog messages={WOLF_CHAT} players={PLAYERS} />
            ) : phase.startsWith("night") ? (
              <NightWaiting phase={phase} />
            ) : (
              <ChatLog messages={MESSAGES} players={PLAYERS} showReasoning={phase === "god"} />
            )}
          </section>

          {/* 行動區 */}
          <footer className="panel pb-safe rounded-t-2xl border-b-0 px-3 pt-3">
            {phase === "day" && (
              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    placeholder="輪到你發言…"
                    className="min-h-12 flex-1 resize-none rounded-xl bg-night/70 px-3 py-2 text-sm outline-none"
                  />
                  <button
                    onClick={startListening}
                    className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${listening ? "bg-blood speaking" : "bg-panel-2"}`}
                    aria-label="語音輸入"
                  >
                    🎙️
                  </button>
                </div>
                <button className="btn-primary h-11 w-full rounded-xl text-sm font-bold">結束發言</button>
              </div>
            )}

            {phase === "vote" && (
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <button className="h-12 rounded-xl bg-panel-2 text-sm">棄票</button>
                <button disabled={!selected} className="btn-primary h-12 rounded-xl text-sm font-bold disabled:opacity-40">
                  {selected ? `投給 ${selected} 號` : "選擇要放逐的玩家"}
                </button>
              </div>
            )}

            {phase === "night-witch" && (
              <div className="space-y-2">
                <p className="text-center text-sm">
                  今晚被刀的是 <b className="text-blood">2 號 墨白</b>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button className="h-12 rounded-xl bg-good/70 text-sm">🧪 救他</button>
                  <button disabled={!selected} className="h-12 rounded-xl bg-wolf/80 text-sm disabled:opacity-40">
                    ☠️ 毒{selected ? ` ${selected}號` : ""}
                  </button>
                  <button className="h-12 rounded-xl bg-panel-2 text-sm">不用藥</button>
                </div>
              </div>
            )}

            {phase === "night-wolf" && (
              <div className="flex gap-2">
                <input placeholder="跟狼隊友說…" className="h-11 flex-1 rounded-xl bg-night/70 px-3 text-sm outline-none" />
                <button className="btn-primary h-11 rounded-xl px-4 text-sm font-bold">🗡️ 投刀</button>
              </div>
            )}

            {(phase === "night-guard" || phase === "night-seer") && (
              <p className="py-3 text-center text-sm text-mist">其他玩家正在行動…</p>
            )}

            {phase === "god" && (
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gold">👁️ 上帝視角</span>
                <div className="flex gap-1.5">
                  {["1×", "2×", "4×"].map((s) => (
                    <button key={s} className="h-9 rounded-lg bg-panel-2 px-3 text-xs">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </footer>
        </>
      )}

      {phase === "dawn" && (
        <DawnOverlay onDone={() => goTo("day")}>
          昨晚死亡的是 <b className="text-blood">6 號 詩詩</b>
        </DawnOverlay>
      )}
      {phase === "dead" && (
        <DeadOverlay message="昨晚你被狼人殺害。你可以用上帝視角繼續觀看，但不能再發言。" onDone={() => goTo("god")} />
      )}
    </main>
  );
}

type SpeechRecognitionLike = {
  lang: string;
  start: () => void;
  onresult: (e: { results: { 0: { transcript: string } }[] }) => void;
  onend: () => void;
};

function NightWaiting({ phase }: { phase: string }) {
  const text: Record<string, string> = {
    "night-guard": "守衛請睜眼，請選擇今晚要守護的人…",
    "night-seer": "預言家請睜眼，請選擇要查驗的人…",
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="font-serif text-lg tracking-widest text-moon/80">天黑請閉眼</p>
      <p className="text-sm text-mist">{text[phase]}</p>
    </div>
  );
}

function RoleReveal({ role, onDone }: { role: Role; onDone: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const info = ROLE_INFO[role];
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-safe">
      <p className="mb-4 text-sm tracking-[0.3em] text-mist">{flipped ? "你的身份是" : "點擊卡片翻開你的身份"}</p>
      <div className="w-full max-w-[280px]">
        <RoleCard role={role} flipped={flipped} onFlip={() => setFlipped(true)} />
      </div>
      <div className={`mt-5 w-full max-w-[280px] text-center transition-opacity duration-500 ${flipped ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <p className="text-sm leading-relaxed text-moon/85">{info.desc}</p>
        <button onClick={onDone} className="btn-primary mt-5 h-12 w-full rounded-xl font-bold tracking-widest">
          我記住了
        </button>
      </div>
    </div>
  );
}

function Result({ winner }: { winner: "good" | "wolf" }) {
  const goodWin = winner === "good";
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-safe">
      <div className="fade-in relative -mx-4 mb-4 aspect-[4/3]">
        <Image src={`/scenes/${winner}-win.jpeg`} alt="" fill priority sizes="(max-width: 480px) 100vw, 480px" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 pb-3 text-center">
          <p className="text-sm tracking-[0.3em] text-mist">遊戲結束</p>
          <h2 className={`mt-1 font-serif text-4xl font-black tracking-widest drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ${goodWin ? "text-good" : "text-wolf"}`}>
            {goodWin ? "好人勝利" : "狼人勝利"}
          </h2>
          <p className="mt-1 text-sm text-gold">{goodWin ? "你以女巫身份獲勝 🎉" : "你以女巫身份落敗"}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PLAYERS.map((p) => {
          const info = ROLE_INFO[p.role];
          return (
            <div key={p.seat} className="panel flex items-center gap-2 rounded-xl px-3 py-2">
              <Avatar src={p.avatar} size={28} alt={p.name} />
              <span className="flex-1 text-sm">
                {p.seat}. {p.name}
              </span>
              <span className={`rounded px-1.5 text-[11px] ${info.team === "wolf" ? "bg-wolf/80" : "bg-good/70"}`}>{info.name}</span>
            </div>
          );
        })}
      </div>
      <h3 className="mt-6 mb-2 font-serif text-lg font-bold">復盤時間軸</h3>
      <ol className="space-y-2 border-l border-gold/30 pl-4 text-sm">
        <li>🌙 第 1 夜：守衛守 2 號｜狼刀 6 號｜女巫未用藥｜預言家驗 3 號 → 狼人</li>
        <li>☀️ 第 1 天：3 號被放逐（7 票）</li>
        <li>🌙 第 2 夜：守衛守 8 號｜狼刀 2 號｜女巫救 2 號</li>
        <li className="text-mist">…</li>
      </ol>
      <div className="mt-6 grid grid-cols-2 gap-2 pb-4">
        <Link href="/" className="panel flex h-12 items-center justify-center rounded-xl text-sm">
          回首頁
        </Link>
        <Link href="/game" className="btn-primary flex h-12 items-center justify-center rounded-xl text-sm font-bold">
          再來一局
        </Link>
      </div>
    </div>
  );
}
