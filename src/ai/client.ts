import type { GameState, Seat } from "@/engine";
import { buildSpeechRequest } from "./speech";

// 向伺服器要一段 AI 發言；任何失敗（沒設 key、額度用完、逾時）都回傳 null，由呼叫端改用罐頭台詞
export async function requestSpeech(s: GameState, seat: Seat, names: string[], style: string): Promise<string | null> {
  try {
    const res = await fetch("/api/ai/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSpeechRequest(s, seat, names, style)),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text ?? null;
  } catch {
    return null;
  }
}
