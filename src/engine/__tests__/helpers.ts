import { reduce } from "../machine";
import { createGame } from "../setup";
import type { Action, GameState, Role, Seat } from "../types";

// 固定身份配置，讓測試可讀：1–4 狼、5–8 民、9 預言家、10 女巫、11 獵人、12 守衛
export const LAYOUT: Record<Seat, Role> = {
  1: "werewolf",
  2: "werewolf",
  3: "werewolf",
  4: "werewolf",
  5: "villager",
  6: "villager",
  7: "villager",
  8: "villager",
  9: "seer",
  10: "witch",
  11: "hunter",
  12: "guard",
};
export const WOLVES = [1, 2, 3, 4];
export const SEER = 9;
export const WITCH = 10;
export const HUNTER = 11;
export const GUARD = 12;

export const newGame = (seed = 1) => createGame({ seed, assigned: LAYOUT });

export const run = (s: GameState, ...actions: Action[]) => actions.reduce(reduce, s);

const isAlive = (s: GameState, seat: Seat) => s.players.find((p) => p.seat === seat)!.alive;

export interface NightPlan {
  guard?: Seat | null;
  knife?: Seat | null;
  witch?: { use: "save" } | { use: "poison"; target: Seat };
  check?: Seat;
}

// 從守衛階段開始跑完一整夜；未指定的角色不行動（等 timeout）
export function playNight(s: GameState, plan: NightPlan): GameState {
  if (plan.guard !== undefined && isAlive(s, GUARD)) s = run(s, { type: "guard", seat: GUARD, target: plan.guard });
  s = run(s, { type: "timeout" });
  if (plan.knife !== undefined) {
    for (const wolf of WOLVES) if (isAlive(s, wolf)) s = run(s, { type: "wolfVote", seat: wolf, target: plan.knife });
  }
  s = run(s, { type: "timeout" });
  if (plan.witch && isAlive(s, WITCH)) s = run(s, { type: "witch", seat: WITCH, ...plan.witch });
  s = run(s, { type: "timeout" });
  if (plan.check !== undefined && isAlive(s, SEER)) s = run(s, { type: "seerCheck", seat: SEER, target: plan.check });
  return run(s, { type: "timeout" });
}

// 依序結束遺言與發言，停在投票（或其他）階段
export function finishSpeeches(s: GameState): GameState {
  while (s.phase.kind === "speech" || s.phase.kind === "lastWords") s = run(s, { type: "endSpeech", seat: s.phase.seat });
  return s;
}

// 所有有投票權的人都投給同一人
export function everyoneVotes(s: GameState, target: Seat | null): GameState {
  const st = s.phase;
  if (st.kind !== "vote") throw new Error(`預期投票階段，實際為 ${st.kind}`);
  const voters = s.players.filter((p) => p.alive && !st.candidates?.includes(p.seat)).map((p) => p.seat);
  return voters.reduce((acc, seat) => run(acc, { type: "vote", seat, target }), s);
}

// 跳過整個白天（不放逐任何人），停在下一夜
export function skipDay(s: GameState): GameState {
  while (s.phase.kind !== "night" && s.phase.kind !== "ended") {
    const st = s.phase;
    if (st.kind === "speech" || st.kind === "lastWords") s = run(s, { type: "endSpeech", seat: st.seat });
    else s = run(s, { type: "timeout" });
  }
  return s;
}
