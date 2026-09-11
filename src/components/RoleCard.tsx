"use client";

import Image from "next/image";
import { CARD_BACK, ROLE_INFO, roleImage, type Role } from "@/lib/mock";

type Props = {
  role: Role;
  flipped: boolean;
  onFlip?: () => void;
  sizes?: string;
};

// 可翻面的角色卡：背面為卡背，翻開後顯示角色插圖與名稱
export function RoleCard({ role, flipped, onFlip, sizes = "280px" }: Props) {
  const info = ROLE_INFO[role];
  const face = "absolute inset-0 overflow-hidden rounded-2xl [backface-visibility:hidden] shadow-[0_20px_60px_-15px_rgba(179,18,46,0.55)]";

  return (
    <button
      type="button"
      onClick={onFlip}
      disabled={!onFlip}
      aria-label={flipped ? `你的身份：${info.name}` : "點擊翻開身份"}
      className="relative aspect-[3/4] w-full [perspective:1200px]"
    >
      <div
        className={`relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] [transform-style:preserve-3d] ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        <div className={face}>
          <Image src={CARD_BACK} alt="" fill priority sizes={sizes} className="object-cover" />
        </div>
        <div className={`${face} [transform:rotateY(180deg)]`}>
          <Image src={roleImage(role)} alt={info.name} fill sizes={sizes} className="object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-night via-night/85 to-transparent pb-7 pt-16">
            <h2 className="font-serif text-4xl font-black tracking-[0.3em] text-moon drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">{info.name}</h2>
            <span className={`mt-2 rounded-full px-3 py-0.5 text-xs ${info.team === "wolf" ? "bg-wolf/85" : "bg-good/75"}`}>
              {info.team === "wolf" ? "狼人陣營" : "好人陣營"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
