import type { GameState, Seat } from "@/engine";

// 即時語音（LiveKit）的權限規則：伺服器簽發 token 與每次換階段同步權限時都用這裡，前端無法自己開麥。
// - main：全體頻道。只有「目前發言者」（白天發言、PK、遺言）能說話，其他人（含死者）只能聽
// - wolves：狼隊私聊頻道。只有狼人能加入；夜晚狼人行動時，存活的狼人可以說話

export type VoiceChannel = "main" | "wolves";

export const VOICE_CHANNELS: VoiceChannel[] = ["main", "wolves"];

// 至少兩位真人才開語音（只有一位真人時，AI 聽不到聲音，語音沒有意義）
export const MIN_HUMANS_FOR_VOICE = 2;

export const roomName = (gameId: string, channel: VoiceChannel) => (channel === "main" ? `game-${gameId}` : `game-${gameId}-wolves`);

export const identityOf = (seat: Seat) => `seat-${seat}`;

export const seatOfIdentity = (identity: string): Seat | null => {
  const m = identity.match(/^seat-(\d+)$/);
  return m ? Number(m[1]) : null;
};

export function canJoin(s: GameState, seat: Seat, channel: VoiceChannel): boolean {
  return channel === "main" || s.players[seat - 1]?.role === "werewolf";
}

export function canSpeak(s: GameState, seat: Seat, channel: VoiceChannel): boolean {
  const p = s.phase;
  const player = s.players[seat - 1];
  if (!player || !canJoin(s, seat, channel)) return false;
  if (channel === "main") return (p.kind === "speech" || p.kind === "lastWords") && p.seat === seat;
  return p.kind === "night" && p.step === "wolf" && player.alive;
}
