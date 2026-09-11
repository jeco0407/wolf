"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

const readNickname = () => {
  try {
    return localStorage.getItem("ww:nickname") ?? "";
  } catch {
    return "";
  }
};

export default function Home() {
  const stored = useSyncExternalStore(
    () => () => {},
    readNickname,
    () => "",
  );
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? stored;
  const [code, setCode] = useState("");
  const router = useRouter();

  const save = (v: string) => {
    setName(v);
    try {
      localStorage.setItem("ww:nickname", v);
    } catch {}
  };

  return (
    <main className="bg-nightscape relative flex min-h-dvh flex-col items-center px-6 pt-safe pb-safe">
      <div className="fog pointer-events-none absolute inset-x-0 bottom-24 h-48" />
      <div className="relative mt-6 aspect-square w-full max-w-[340px] [mask-image:radial-gradient(circle_at_center,black_52%,transparent_72%)]">
        <Image src="/moon.jpeg" alt="" fill priority sizes="340px" className="object-cover" />
      </div>

      <h1 className="-mt-10 relative font-serif text-5xl font-black tracking-widest text-moon drop-shadow-[0_0_20px_rgba(179,18,46,0.5)]">
        月夜狼人殺
      </h1>
      <p className="mt-3 text-sm tracking-[0.3em] text-mist">十二人標準局 · 真人連線 · AI 補位</p>

      <div className="mt-auto w-full space-y-3 pb-6">
        <label className="block">
          <span className="mb-1 block text-xs text-mist">你的暱稱</span>
          <input
            value={name}
            onChange={(e) => save(e.target.value)}
            maxLength={8}
            placeholder="輸入暱稱"
            className="panel h-12 w-full rounded-xl px-4 text-base outline-none placeholder:text-mist/60 focus:border-gold/60"
          />
        </label>

        <Link
          href="/room/WXYZ"
          className="btn-primary flex h-14 w-full items-center justify-center rounded-xl font-serif text-lg font-black tracking-widest"
        >
          建立房間
        </Link>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 4) router.push(`/room/${code}`);
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
            placeholder="輸入 4 碼房號"
            className="panel h-12 min-w-0 flex-1 rounded-xl px-4 text-center font-mono text-lg tracking-[0.4em] outline-none placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-mist/60"
          />
          <button disabled={code.length !== 4} className="h-12 rounded-xl bg-panel-2 px-5 text-sm font-bold disabled:opacity-40">
            加入
          </button>
        </form>

        <div className="grid grid-cols-3 gap-3">
          {[
            { href: "/tutorial", label: "新手教學", icon: "📜" },
            { href: "/stats", label: "戰績", icon: "🏆" },
            { href: "/settings", label: "設定", icon: "⚙️" },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="panel flex h-16 flex-col items-center justify-center rounded-xl text-xs">
              <span className="text-xl">{l.icon}</span>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
