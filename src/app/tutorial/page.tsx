import Image from "next/image";
import Link from "next/link";
import { SceneBackground } from "@/components/SceneBackground";
import { ROLE_INFO, roleImage, type Role } from "@/lib/mock";

const FLOW = ["🌙 夜晚：守衛 → 狼人 → 女巫 → 預言家", "☀️ 天亮公布死訊（首夜死者有遺言）", "🗣️ 依序發言，每人 90 秒", "🗳️ 投票放逐，平票者 PK 後重投", "⚖️ 勝負判定後進入下一夜"];

export default function Tutorial() {
  return (
    <main className="relative isolate min-h-dvh px-4 pt-safe pb-safe">
      <SceneBackground isNight fixed />
      <header className="flex items-center gap-3 py-3">
        <Link href="/" className="text-mist">
          ←
        </Link>
        <h1 className="font-serif text-2xl font-black tracking-widest">新手教學</h1>
      </header>

      <section className="panel rounded-2xl p-4">
        <h2 className="mb-2 font-serif text-lg font-bold text-gold">勝利條件（屠邊）</h2>
        <p className="text-sm leading-relaxed">
          <b className="text-good">好人</b>：放逐所有狼人。
          <br />
          <b className="text-wolf">狼人</b>：殺光所有神職，或殺光所有平民。
        </p>
      </section>

      <section className="panel mt-3 rounded-2xl p-4">
        <h2 className="mb-2 font-serif text-lg font-bold text-gold">一局的流程</h2>
        <ol className="space-y-1.5 text-sm">
          {FLOW.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ol>
      </section>

      <h2 className="mt-5 mb-2 font-serif text-lg font-bold">角色（12 人局：4 狼 4 民 4 神）</h2>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(ROLE_INFO) as Role[]).map((role, i) => {
          const r = ROLE_INFO[role];
          return (
            <div key={role} className="panel overflow-hidden rounded-xl">
              <div className="relative aspect-[3/4]">
                <Image src={roleImage(role)} alt={r.name} fill loading={i < 2 ? "eager" : "lazy"} sizes="(max-width: 480px) 50vw, 220px" className="object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night to-transparent px-3 pb-2 pt-8">
                  <span className="font-serif text-lg font-black tracking-widest">{r.name}</span>
                  <span className={`ml-2 rounded px-1.5 text-[10px] ${r.team === "wolf" ? "bg-wolf/85" : "bg-good/75"}`}>
                    {r.team === "wolf" ? "狼人" : "好人"}
                  </span>
                </div>
              </div>
              <p className="p-3 text-xs leading-relaxed text-moon/75">{r.desc}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-mist">特殊規則：守衛與女巫同時守救同一人，該玩家仍會死亡（同守同救）。</p>
    </main>
  );
}
