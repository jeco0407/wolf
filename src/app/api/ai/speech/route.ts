import { buildMessages, cleanSpeech, validateSpeechRequest } from "@/ai/speech";
import { toTraditional } from "@/ai/traditional";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";

// Qwen3 預設會先「思考」再回答，發言不需要，關掉以節省 token；gpt-oss 無法關閉，只能調低
function reasoningParams(model: string) {
  if (model.startsWith("qwen/")) return { reasoning_effort: "none" };
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low" };
  return {};
}

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

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: buildMessages(speech),
        temperature: 0.9,
        max_tokens: 220,
        ...reasoningParams(model),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return error("Groq 連線逾時", 504);
  }

  // 429 代表 Groq 額度用完，前端會改用罐頭台詞
  if (!res.ok) return error(`Groq 回應 ${res.status}`, res.status === 429 ? 429 : 502);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = cleanSpeech(toTraditional(data.choices?.[0]?.message?.content ?? ""));
  if (!text) return error("模型沒有回應內容", 502);
  return Response.json({ text });
}
