"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { SceneBackground } from "@/components/SceneBackground";
import type { Role } from "@/engine";
import { ROLE_INFO } from "@/lib/mock";
import { clearRecords, getRecords, getServerRecords, rate, subscribeRecords, summarize, type RoleStat } from "@/lib/stats";

const ROLES: Role[] = ["werewolf", "villager", "seer", "witch", "hunter", "guard"];
const NO_GAMES: RoleStat = { games: 0, wins: 0 };

const formatDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function Bar({ pct, team }: { pct: number; team: "wolf" | "good" }) {
  return (
    <div className="mt-1.5 h-1.5 rounded-full bg-night">
      <div className={`h-full rounded-full ${team === "wolf" ? "bg-wolf" : "bg-good"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Stats() {
  const records = useSyncExternalStore(subscribeRecords, getRecords, getServerRecords);
  const [confirming, setConfirming] = useState(false);
  const s = summarize(records);
  const recent = records.slice(-10).reverse();

  return (
    <main className="relative isolate min-h-dvh px-4 pt-safe pb-safe">
      <SceneBackground isNight fixed />
      <header className="flex items-center gap-3 py-3">
        <Link href="/" className="flex h-11 w-11 items-center text-mist" aria-label="返回首頁">
          ←
        </Link>
        <h1 className="font-serif text-2xl font-black tracking-widest">戰績</h1>
      </header>

      {s.games === 0 ? (
        <div className="panel mt-6 rounded-xl px-4 py-8 text-center">
          <p className="text-mist">還沒有對局紀錄。</p>
          <p className="mt-1 text-sm text-mist">打完一局後，勝負會自動記在這台裝置上。</p>
          <Link href="/play" className="btn-primary mt-5 inline-block rounded-xl px-6 py-3">
            開始一局
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ["總場數", s.games],
              ["勝率", `${rate(s)}%`],
              ["最佳連勝", s.bestStreak],
            ].map(([k, v]) => (
              <div key={k} className="panel rounded-xl py-3 text-center">
                <div className="font-serif text-2xl font-black text-gold">{v}</div>
                <div className="text-xs text-mist">{k}</div>
              </div>
            ))}
          </div>
          {s.streak >= 2 && <p className="mt-2 text-center text-sm text-gold">目前 {s.streak} 連勝中</p>}

          <h2 className="mt-5 mb-2 font-serif text-lg font-bold">陣營</h2>
          <div className="grid grid-cols-2 gap-2">
            {(["good", "wolf"] as const).map((team) => (
              <div key={team} className="panel rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{team === "good" ? "好人陣營" : "狼人陣營"}</span>
                  <b className="text-moon">{rate(s.byTeam[team])}%</b>
                </div>
                <div className="text-xs text-mist">
                  {s.byTeam[team].wins} 勝 / {s.byTeam[team].games} 場
                </div>
                <Bar pct={rate(s.byTeam[team])} team={team} />
              </div>
            ))}
          </div>

          <h2 className="mt-5 mb-2 font-serif text-lg font-bold">各角色</h2>
          <div className="space-y-2">
            {ROLES.map((r) => {
              const stat = s.byRole[r] ?? NO_GAMES;
              return (
                <div key={r} className="panel rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {ROLE_INFO[r].icon} {ROLE_INFO[r].name}
                    </span>
                    <span className="text-mist">
                      {stat.games ? (
                        <>
                          {stat.wins}/{stat.games} · <b className="text-moon">{rate(stat)}%</b>
                        </>
                      ) : (
                        "尚未抽到"
                      )}
                    </span>
                  </div>
                  <Bar pct={rate(stat)} team={ROLE_INFO[r].team} />
                </div>
              );
            })}
          </div>

          <h2 className="mt-5 mb-2 font-serif text-lg font-bold">最近對局</h2>
          <ul className="panel divide-y divide-white/5 rounded-xl">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className={`w-8 shrink-0 font-serif font-black ${r.won ? "text-gold" : "text-mist"}`}>{r.won ? "勝" : "敗"}</span>
                <span className="flex-1">
                  {ROLE_INFO[r.role].icon} {ROLE_INFO[r.role].name}
                  <span className="ml-2 text-xs text-mist">
                    第 {r.days} 天結束 · {r.survived ? "存活" : "出局"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-mist">{formatDate(r.at)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 mb-4 text-center">
            {confirming ? (
              <div className="flex justify-center gap-3">
                <button
                  className="min-h-11 rounded-xl bg-blood px-5 text-sm font-bold"
                  onClick={() => {
                    clearRecords();
                    setConfirming(false);
                  }}
                >
                  確定清除
                </button>
                <button className="min-h-11 rounded-xl px-5 text-sm text-mist" onClick={() => setConfirming(false)}>
                  取消
                </button>
              </div>
            ) : (
              <button className="min-h-11 px-4 text-sm text-mist underline" onClick={() => setConfirming(true)}>
                清除所有戰績
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
