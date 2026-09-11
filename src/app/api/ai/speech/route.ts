import { validateSpeechRequest } from "@/ai/speech";
import { DEFAULT_MODEL, generateSpeech } from "@/ai/groq";

// 簡單的每 IP 速率限制（同一個執行個體內）；Groq 本身還有組織層級的額度
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const error = (message: string, status: number) => Response.json({ error: message }, { status });

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return error("尚未設定 GROQ_API_KEY", 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return error("請求太頻繁", 429);

  const raw = await req.text();
  if (raw.length > 16_000) return error("請求太大", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error("格式錯誤", 400);
  }
  const speech = validateSpeechRequest(body);
  if (!speech) return error("格式錯誤", 400);

  const result = await generateSpeech(speech, key, process.env.GROQ_MODEL || DEFAULT_MODEL);
  if ("error" in result) return error(result.error, result.status);
  return Response.json({ text: result.text });
}
