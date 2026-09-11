"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SceneBackground } from "@/components/SceneBackground";
import { ROLE_INFO, type Role } from "@/lib/mock";
import { getPlayerId, readNickname, saveNickname } from "@/lib/player";

const errorText = (e: unknown) => (e instanceof ConvexError ? String(e.data) : "連線失敗，請稍後再試");

// 等待室：Convex 即時同步成員；房主可以踢人、指定角色、開始遊戲
export default function Room({ code }: { code: string }) {
  const router = useRouter();
  const [playerId] = useState(getPlayerId);
  const room = useQuery(api.rooms.get, { code, playerId });
  const join = useMutation(api.rooms.join);
  const leave = useMutation(api.rooms.leave);
  const kick = useMutation(api.rooms.kick);
  const assign = useMutation(api.rooms.assign);
  const start = useMutation(api.rooms.start);

  const [name, setName] = useState(() => readNickname());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const autoJoined = useRef(false);

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  // 點連結進來、已經有暱稱的人自動加入
  const member = room?.youId != null;
  useEffect(() => {
    if (!room || member || room.status !== "lobby" || autoJoined.current) return;
    const stored = readNickname();
    if (!stored) return;
    autoJoined.current = true;
    join({ code, playerId, name: stored }).catch((e) => setError(errorText(e)));
  }, [room, member, code, playerId, join]);

  // 遊戲開始 → 進入遊戲畫面
  useEffect(() => {
    if (room?.status === "playing" && room.inGame) router.replace(`/game/${code}`);
  }, [room?.status, room?.inGame, code, router]);

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

  const exit = async () => {
    await leave({ code, playerId }).catch(() => {});
    router.push("/");
  };

  if (room === undefined) return <Shell>連線中…</Shell>;
  if (room === null) {
    return (
      <Shell>
        找不到房號 {code} 的房間。
        <Link href="/" className="mt-4 block text-gold underline">
          回首頁
        </Link>
      </Shell>
    );
  }

  if (!member) {
    if (room.status === "playing") {
      return (
        <Shell>
          這個房間正在遊戲中，請等這局結束後再加入。
          <Link href="/" className="mt-4 block text-gold underline">
            回首頁
          </Link>
        </Shell>
      );
    }
    return (
      <Shell>
        <form
          className="w-full max-w-[320px] space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            saveNickname(name.trim());
            await run(() => join({ code, playerId, name }));
          }}
        >
          <p className="text-moon">
            加入房間 <b className="font-mono tracking-[0.2em] text-gold">{code}</b>
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={8}
            placeholder="輸入暱稱"
            className="panel h-12 w-full rounded-xl px-4 text-base text-moon outline-none placeholder:text-mist/60"
          />
          <button disabled={!name.trim()} className="btn-primary h-12 w-full rounded-xl font-bold disabled:opacity-40">
            加入
          </button>
          {error && <p className="text-sm text-blood">{error}</p>}
        </form>
      </Shell>
    );
  }

  const aiCount = 12 - room.members.length;
  const roleOptions = Object.keys(ROLE_INFO) as Role[];

  return (
    <main className="relative isolate flex min-h-dvh flex-col px-4 pt-safe pb-safe">
      <SceneBackground isNight fixed />
      <header className="flex items-center gap-3 py-3">
        <button onClick={exit} className="flex h-11 w-11 items-center text-mist" aria-label="離開房間">
          ←
        </button>
        <h1 className="font-serif text-xl font-black tracking-widest">等待室</h1>
      </header>

      <section className="panel flex items-center justify-between rounded-2xl px-4 py-3">
        <div>
          <div className="text-xs text-mist">房號</div>
          <div className="font-mono text-3xl font-bold tracking-[0.3em] text-gold">{room.code}</div>
        </div>
        <button onClick={share} className="btn-primary h-11 rounded-xl px-4 text-sm font-bold">
          {copied ? "已複製連結 ✓" : "📤 邀請朋友"}
        </button>
      </section>

      <div className="mt-4 mb-2 flex items-baseline justify-between">
        <h2 className="font-serif text-lg font-bold">玩家 {room.members.length}/12</h2>
        <span className="text-xs text-mist">空位將由 {aiCount} 位 AI 補上</span>
      </div>

      <ul className="space-y-2">
        {room.members.map((p, i) => (
          <li key={p.id} className="panel flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="w-5 text-center text-xs font-bold text-gold">{i + 1}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-panel-2 font-serif text-sm">{p.name.slice(0, 1)}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {p.name}
              {p.id === room.youId && <span className="ml-1 text-xs text-mist">（你）</span>}
              {p.host && <span className="ml-1.5 rounded bg-gold/80 px-1 text-[10px] text-night">房主</span>}
            </span>
            {room.isHost && (
              <select
                value={room.assigned[p.id] ?? "random"}
                onChange={(e) => {
                  const value = e.target.value;
                  void run(() => assign({ code, playerId, targetId: p.id, role: value === "random" ? null : (value as Role) }));
                }}
                className="h-9 rounded-lg bg-panel-2 px-2 text-xs outline-none"
                aria-label={`指定 ${p.name} 的角色`}
              >
                <option value="random">🎲 隨機</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_INFO[r].icon} {ROLE_INFO[r].name}
                  </option>
                ))}
              </select>
            )}
            {room.isHost && !p.host && (
              <button
                onClick={() => void run(() => kick({ code, playerId, targetId: p.id }))}
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
            <span className="w-5 text-center text-xs">{room.members.length + i + 1}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-panel-2/50 text-lg">🤖</span>
            <span className="text-sm">等待加入…（開始時由 AI 補位）</span>
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 mt-4 pt-2 pb-2">
        {error && <p className="mb-2 text-center text-sm text-blood">{error}</p>}
        {room.status === "playing" ? (
          <p className="text-center text-sm text-mist">遊戲進行中…</p>
        ) : room.isHost ? (
          <button
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              if (!(await run(() => start({ code, playerId })))) setStarting(false);
            }}
            className="btn-primary flex h-14 w-full items-center justify-center rounded-xl font-serif text-lg font-black tracking-widest disabled:opacity-60"
          >
            {starting ? "發牌中…" : "開始遊戲"}
          </button>
        ) : (
          <p className="text-center text-sm text-mist">等待房主開始遊戲…</p>
        )}
      </div>
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center px-6 text-center text-mist">
      <SceneBackground isNight fixed />
      {children}
    </main>
  );
}
