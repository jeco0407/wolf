import Link from "next/link";
import { SceneBackground } from "@/components/SceneBackground";
import { ROLE_INFO } from "@/lib/mock";

// 原型假資料；正式版從 localStorage 讀取
const ROLE_STATS = { werewolf: [5, 9], villager: [3, 8], seer: [2, 3], witch: [2, 2], hunter: [1, 3], guard: [0, 1] } as const;

export default function Stats() {
  const total = Object.values(ROLE_STATS).reduce((a, [, n]) => a + n, 0);
  const wins = Object.values(ROLE_STATS).reduce((a, [w]) => a + w, 0);
  return (
    <main className="relative isolate min-h-dvh px-4 pt-safe pb-safe">
      <SceneBackground isNight fixed />
      <header className="flex items-center gap-3 py-3">
        <Link href="/" className="text-mist">
          ←
        </Link>
        <h1 className="font-serif text-2xl font-black tracking-widest">戰績</h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["總場數", total],
          ["勝場", wins],
          ["勝率", `${Math.round((wins / total) * 100)}%`],
        ].map(([k, v]) => (
          <div key={k} className="panel rounded-xl py-3 text-center">
            <div className="font-serif text-2xl font-black text-gold">{v}</div>
            <div className="text-xs text-mist">{k}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-5 mb-2 font-serif text-lg font-bold">各角色</h2>
      <div className="space-y-2">
        {(Object.keys(ROLE_STATS) as (keyof typeof ROLE_STATS)[]).map((r) => {
          const [w, n] = ROLE_STATS[r];
          const pct = n ? Math.round((w / n) * 100) : 0;
          return (
            <div key={r} className="panel rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {ROLE_INFO[r].icon} {ROLE_INFO[r].name}
                </span>
                <span className="text-mist">
                  {w}/{n} · <b className="text-moon">{pct}%</b>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-night">
                <div className={`h-full rounded-full ${ROLE_INFO[r].team === "wolf" ? "bg-wolf" : "bg-good"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
