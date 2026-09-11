"use client";

import { useEffect, useRef } from "react";
import { Avatar } from "@/components/Avatar";
import { say } from "@/voice/audio";

export type ChatMessage =
  | { kind: "judge"; text: string }
  | { kind: "private"; text: string }
  | { kind: "speech"; seat: number; text: string; tag?: string; reasoning?: string }
  | {
      kind: "vote";
      pk: boolean;
      result: string;
      exiled: boolean;
      rows: { target: number; voters: number[]; top: boolean }[];
      abstain: number[];
    };

export type ChatPlayer = {
  seat: number;
  name: string;
  avatar: string;
  isUser?: boolean;
  voice?: { pitch: number; rate: number };
};

// 手動重播：不受「自動朗讀」設定影響，並中斷目前的朗讀
export function speak(text: string, voice?: ChatPlayer["voice"]) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  void say(text, { kind: "ai", voice, force: true });
}

function VoteCard({ vote, players }: { vote: Extract<ChatMessage, { kind: "vote" }>; players: ChatPlayer[] }) {
  const max = Math.max(1, ...vote.rows.map((r) => r.voters.length));
  return (
    <div className="panel mx-auto w-full rounded-2xl border-gold/40 p-3">
      <div className="text-center text-[11px] tracking-[0.2em] text-mist">🗳️ {vote.pk ? "PK 投票結果" : "投票結果"}</div>
      <div className={`mt-1 text-center font-serif text-base font-black ${vote.exiled ? "text-blood" : "text-gold"}`}>{vote.result}</div>
      <div className="mt-2 space-y-1">
        {vote.rows.map((r) => {
          const p = players.find((x) => x.seat === r.target);
          return (
            <div key={r.target} className={`relative overflow-hidden rounded-lg bg-night/40 ${r.top ? "ring-1 ring-blood/60" : ""}`}>
              {/* 票數長條直接當作這一列的背景 */}
              <div
                className={`absolute inset-y-0 left-0 ${r.top ? "bg-blood/35" : "bg-mist/15"}`}
                style={{ width: `${(r.voters.length / max) * 100}%` }}
              />
              <div className="relative flex items-center gap-2 px-2 py-1">
                {p && <Avatar src={p.avatar} size={22} alt={p.name} className="shrink-0" />}
                <span className="w-[5.5rem] shrink-0 truncate text-xs">
                  {r.target} 號 {p?.name}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                  {r.voters.map((v) => (
                    <span key={v} className="flex h-4 min-w-4 items-center justify-center rounded-full bg-panel-2/90 px-1 text-[9px] text-moon/80">
                      {v}
                    </span>
                  ))}
                </span>
                <span className={`shrink-0 text-sm font-bold ${r.top ? "text-blood" : "text-moon/70"}`}>{r.voters.length} 票</span>
              </div>
            </div>
          );
        })}
        {vote.abstain.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-2 text-[11px] text-mist">
            棄票：
            {vote.abstain.map((v) => (
              <span key={v} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-panel-2/60 px-1 text-[10px]">
                {v}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatLog({ messages, players, showReasoning }: { messages: ChatMessage[]; players: ChatPlayer[]; showReasoning?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      {messages.map((m, i) => {
        if (m.kind === "judge") {
          return (
            <div key={i} className="mx-auto max-w-[90%] rounded-full border border-gold/30 bg-night/60 px-3 py-1 text-center text-xs text-gold">
              ⚖️ {m.text}
            </div>
          );
        }
        if (m.kind === "private") {
          return (
            <div key={i} className="mx-auto max-w-[90%] rounded-lg border border-dashed border-gold/40 bg-panel/70 px-3 py-1 text-center text-xs text-gold/90">
              🔒 {m.text}
            </div>
          );
        }
        if (m.kind === "vote") return <VoteCard key={i} vote={m} players={players} />;
        const p = players.find((x) => x.seat === m.seat);
        if (!p) return null;
        return (
          <div key={i} className={`flex gap-2 ${p.isUser ? "flex-row-reverse" : ""}`}>
            <Avatar src={p.avatar} size={32} alt={p.name} className="shrink-0" />
            <div className={`flex max-w-[78%] flex-col ${p.isUser ? "items-end" : ""}`}>
              <span className="mb-0.5 text-[11px] text-mist">
                {m.tag && <span className="mr-1 rounded bg-panel-2 px-1 text-gold">{m.tag}</span>}
                {p.seat} 號 {p.name}
              </span>
              <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${p.isUser ? "rounded-tr-sm bg-blood/70" : "panel rounded-tl-sm"}`}>
                {m.text}
                {!p.isUser && (
                  <button type="button" onClick={() => speak(m.text, p.voice)} className="ml-1.5 align-middle text-xs text-gold/80" aria-label="朗讀">
                    🔊
                  </button>
                )}
              </div>
              {showReasoning && m.reasoning && (
                <div className="mt-1 rounded-lg border border-dashed border-mist/40 px-2 py-1 text-[11px] text-mist">💭 {m.reasoning}</div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
