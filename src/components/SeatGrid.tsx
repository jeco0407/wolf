"use client";

import { Avatar } from "@/components/Avatar";
import { ROLE_INFO, type Role } from "@/lib/mock";

// role 為 null 表示這個視角看不到該玩家的身份
export type SeatPlayer = {
  seat: number;
  name: string;
  avatar: string;
  alive: boolean;
  role: Role | null;
  isUser?: boolean;
  isAI?: boolean;
  offline?: boolean;
};

type Props = {
  players: SeatPlayer[];
  speakingSeat?: number;
  selectable?: (p: SeatPlayer) => boolean;
  selected?: number | null;
  onSelect?: (seat: number) => void;
  revealAll?: boolean;
  wolfTeammates?: boolean;
};

export function SeatGrid({ players, speakingSeat, selectable, selected, onSelect, revealAll, wolfTeammates }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2 px-3">
      {players.map((p) => {
        const canPick = selectable?.(p) ?? false;
        const isSelected = selected === p.seat;
        const info = p.role ? ROLE_INFO[p.role] : null;
        const showRole = revealAll || p.isUser || (wolfTeammates && p.role === "werewolf");
        return (
          <button
            key={p.seat}
            type="button"
            disabled={!canPick}
            onClick={() => onSelect?.(p.seat)}
            className={[
              "relative flex flex-col items-center rounded-xl py-2 transition",
              "panel min-h-[76px]",
              !p.alive && "opacity-40 grayscale",
              canPick && "ring-1 ring-gold/40 active:scale-95",
              isSelected && "!ring-2 !ring-blood bg-blood/20",
              p.isUser && "border-gold/60",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="absolute left-1.5 top-1 text-[10px] font-bold text-gold">{p.seat}</span>
            {(p.isAI || p.offline) && (
              <span className="absolute bottom-1 right-1 rounded bg-panel-2 px-1 text-[9px] text-mist">{p.offline ? "斷線·AI代打" : "AI"}</span>
            )}
            {showRole && info && (
              <span
                className={`absolute right-1 top-1 rounded px-1 text-[10px] ${info.team === "wolf" ? "bg-wolf/80" : "bg-good/70"}`}
              >
                {info.name}
              </span>
            )}
            <span className={`relative mt-2 block rounded-full ${speakingSeat === p.seat ? "speaking ring-2 ring-gold" : ""}`}>
              <Avatar src={p.avatar} size={40} />
              {!p.alive && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-night/60 text-lg">💀</span>}
            </span>
            <span className={`mt-1 text-xs ${p.isUser ? "text-gold font-bold" : "text-moon/90"}`}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
