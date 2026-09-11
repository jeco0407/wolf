import { GODS, type Player, type Team } from "./types";

// 屠邊：狼全滅好人勝；神職全滅或平民全滅狼人勝
export function winnerOf(players: Player[]): Team | null {
  const alive = players.filter((p) => p.alive);
  if (!alive.some((p) => p.role === "werewolf")) return "good";
  if (!alive.some((p) => GODS.includes(p.role)) || !alive.some((p) => p.role === "villager")) return "wolf";
  return null;
}
