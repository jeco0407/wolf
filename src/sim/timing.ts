import { PERSONAS } from "@/ai/personas";
import type { GameState, InteractiveStep, Seat } from "@/engine";
import { drawAvatars } from "@/lib/avatars";

// 本機模擬（LocalGame）與 Convex 連線對局共用的節奏與座位設定

export interface SeatMeta {
  seat: Seat;
  name: string;
  avatar: string;
  // 真人玩家（本機模擬時是「自己」，連線時是任何真人）
  isUser: boolean;
  style?: string;
  voice?: { pitch: number; rate: number };
}

// 各階段時限（毫秒）。夜晚每步固定時長，與角色死活無關，避免從等待時間推敲身份
export const DURATION: Record<InteractiveStep["kind"], number> = {
  night: 6000,
  speech: 90000,
  lastWords: 60000,
  vote: 30000,
  hunter: 15000,
  ended: 0,
};

// AI 行動的延遲，讓節奏像真人
export function botDelay(phase: InteractiveStep): number {
  if (phase.kind === "speech" || phase.kind === "lastWords") return 1800 + Math.random() * 1500;
  if (phase.kind === "vote") return 600 + Math.random() * 3000;
  return 800 + Math.random() * 2500;
}

// AI 發言顯示後停留多久才換下一位：約每 10 字 1 秒，2.5–12 秒。
// 讓玩家讀得完，也把呼叫頻率壓在 Groq 每分鐘 token 額度內
export const readMs = (text: string) => Math.min(12000, Math.max(2500, text.length * 100));

// 目前階段的識別字串：階段一變，計時與 AI 排程就重來
export const phaseKeyOf = (s: GameState) => `${s.day}:${JSON.stringify(s.phase)}`;

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 產生 12 個座位的名字、頭像與 AI 人設；humans 是真人座位 → 暱稱
export function buildSeats(humans: Map<Seat, string>): SeatMeta[] {
  const avatars = drawAvatars(12);
  const personas = shuffle(PERSONAS);
  return Array.from({ length: 12 }, (_, i) => {
    const seat = i + 1;
    const name = humans.get(seat);
    if (name !== undefined) return { seat, name, avatar: avatars[i], isUser: true };
    const persona = personas.pop()!;
    return {
      seat,
      name: persona.name,
      style: persona.style,
      avatar: avatars[i],
      isUser: false,
      voice: { pitch: 0.7 + Math.random() * 0.7, rate: 0.95 + Math.random() * 0.3 },
    };
  });
}
