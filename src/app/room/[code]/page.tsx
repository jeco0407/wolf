"use client";

import Link from "next/link";
import { SceneBackground } from "@/components/SceneBackground";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { LOBBY, ROLE_INFO, type Role } from "@/lib/mock";

// 原型：以「房主視角」呈現等待室。正式版由 Convex 同步房間狀態。
export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const [players, setPlayers] = useState(LOBBY);
  const [assigned, setAssigned] = useState<Record<string, Role | "random">>({});
  const [copied, setCopied] = useState(false);
  const isHost = true;
  const aiCount = 12 - players.length;

  const share = async () => {
    const url = `${location.origin}/room/${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "月夜狼人殺", text: `來玩狼人殺！房號 ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {}
  };

  return (
    <main className="relative isolate flex min-h-dvh flex-col px-4 pt-safe pb-safe">
      <SceneBackground isNight fixed />
      <header className="flex items-center gap-3 py-3">
        <Link href="/" className="text-mist">
          ←
        </Link>
        <h1 className="font-serif text-xl font-black tracking-widest">等待室</h1>
      </header>

      <section className="panel flex items-center justify-between rounded-2xl px-4 py-3">
        <div>
          <div className="text-xs text-mist">房號</div>
          <div className="font-mono text-3xl font-bold tracking-[0.3em] text-gold">{code}</div>
        </div>
        <button onClick={share} className="btn-primary h-11 rounded-xl px-4 text-sm font-bold">
          {copied ? "已複製連結 ✓" : "📤 邀請朋友"}
        </button>
      </section>

      <div className="mt-4 mb-2 flex items-baseline justify-between">
        <h2 className="font-serif text-lg font-bold">玩家 {players.length}/12</h2>
        <span className="text-xs text-mist">空位將由 {aiCount} 位 AI 補上</span>
      </div>

      <ul className="space-y-2">
        {players.map((p, i) => (
          <li key={p.id} className="panel flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="w-5 text-center text-xs font-bold text-gold">{i + 1}</span>
            <Avatar src={p.avatar} size={36} alt={p.name} />
            <span className="flex-1 text-sm">
              {p.name}
              {p.host && <span className="ml-1.5 rounded bg-gold/80 px-1 text-[10px] text-night">房主</span>}
            </span>
            {isHost && (
              <select
                value={assigned[p.id] ?? "random"}
                onChange={(e) => setAssigned((a) => ({ ...a, [p.id]: e.target.value as Role | "random" }))}
                className="h-9 rounded-lg bg-panel-2 px-2 text-xs outline-none"
                aria-label="指定角色"
              >
                <option value="random">🎲 隨機</option>
                {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_INFO[r].icon} {ROLE_INFO[r].name}
                  </option>
                ))}
              </select>
            )}
            {isHost && !p.host && (
              <button
                onClick={() => setPlayers((ps) => ps.filter((x) => x.id !== p.id))}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-wolf"
                aria-label={`踢出 ${p.name}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {Array.from({ length: aiCount }).map((_, i) => (
          <li key={`ai-${i}`} className="flex items-center gap-3 rounded-xl border border-dashed border-mist/25 px-3 py-2 text-mist/70">
            <span className="w-5 text-center text-xs">{players.length + i + 1}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-panel-2/50 text-lg">🤖</span>
            <span className="text-sm">等待加入…（開始時由 AI 補位）</span>
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 mt-4 pb-2 pt-2">
        {isHost ? (
          <Link
            href="/play"
            className="btn-primary flex h-14 w-full items-center justify-center rounded-xl font-serif text-lg font-black tracking-widest"
          >
            開始遊戲
          </Link>
        ) : (
          <p className="text-center text-sm text-mist">等待房主開始遊戲…</p>
        )}
      </div>
    </main>
  );
}
