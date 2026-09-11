import Image from "next/image";
import type { ReactNode } from "react";

// 天亮過場：全螢幕，點一下繼續
export function DawnOverlay({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  return (
    <button type="button" onClick={onDone} className="fade-in absolute inset-0 z-20 flex flex-col justify-end bg-night">
      <Image src="/scenes/dawn.jpeg" alt="" fill sizes="(max-width: 480px) 100vw, 480px" className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-night via-night/50 to-transparent" />
      <div className="relative w-full px-6 pb-16 text-center">
        <p className="font-serif text-4xl font-black tracking-[0.3em]">天亮了</p>
        <p className="mt-4 text-base">{children}</p>
        <p className="mt-8 animate-pulse text-xs text-mist">點擊繼續</p>
      </div>
    </button>
  );
}

// 出局提示：切換到上帝視角觀戰
export function DeadOverlay({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <div className="fade-in absolute inset-0 z-20 flex flex-col items-center justify-center bg-night/85 px-6 backdrop-blur-sm">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl ring-1 ring-gold/30">
        <Image src="/scenes/dead.jpeg" alt="" fill sizes="440px" className="object-cover" />
      </div>
      <h2 className="mt-6 font-serif text-3xl font-black tracking-[0.3em]">你已出局</h2>
      <p className="mt-2 text-center text-sm leading-relaxed text-mist">{message}</p>
      <button onClick={onDone} className="btn-primary mt-6 h-12 w-full rounded-xl font-bold tracking-widest">
        👁️ 進入觀戰
      </button>
    </div>
  );
}
