import { findPlayer } from "./machine";
import type { Audience, GameEvent, GameState, InteractiveStep, Role, Seat } from "./types";

export type Viewer = Seat | "god";

export interface PlayerView {
  seat: Seat;
  alive: boolean;
  role: Role | null;
}

export interface GameView {
  day: number;
  phase: InteractiveStep;
  // 上帝視角：死者、遊戲結束後、觀戰者
  omniscient: boolean;
  you: { seat: Seat; role: Role; alive: boolean } | null;
  players: PlayerView[];
  events: GameEvent[];
  potions: GameState["potions"] | null;
  lastGuard: Seat | null;
}

// 防作弊核心：真人前端與 AI 都只能拿到這裡過濾後的資料，絕不直接下發 GameState
// ignoreDeath：以「還活著」的視角取資料。AI 發表遺言時用，避免死者拿到上帝視角的資訊後說出來
export function viewFor(s: GameState, viewer: Viewer, opts: { ignoreDeath?: boolean } = {}): GameView {
  const me = viewer === "god" ? null : findPlayer(s, viewer);
  const omniscient = !me || (!me.alive && !opts.ignoreDeath) || s.phase.kind === "ended";
  const isWolf = me?.role === "werewolf";

  const canSee = (to: Audience): boolean => {
    if (omniscient || to === "all") return true;
    if (to === "wolves") return isWolf;
    if (to === "god") return false;
    return to.seats.includes(me!.seat);
  };

  return {
    day: s.day,
    phase: s.phase,
    omniscient,
    you: me ? { seat: me.seat, role: me.role, alive: me.alive } : null,
    players: s.players.map((p) => ({
      seat: p.seat,
      alive: p.alive,
      role:
        omniscient || p.seat === me?.seat || (isWolf && p.role === "werewolf") ? p.role : null,
    })),
    events: s.events.filter((e) => canSee(e.to)),
    potions: omniscient || me?.role === "witch" ? s.potions : null,
    lastGuard: omniscient || me?.role === "guard" ? s.lastGuard : null,
  };
}
