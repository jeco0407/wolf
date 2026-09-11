import { buildMessages, cleanSpeech, type SpeechRequest } from "./speech";
import { toTraditional } from "./traditional";

// 呼叫 Groq 產生一段發言。Next.js 的 /api/ai/speech（本機模擬）與 Convex 的 ai.speak（連線對局）共用。
// 只在伺服器端執行：key 由呼叫端從環境變數讀取傳入。

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_MODEL = "qwen/qwen3.8-27b";

// Qwen3 預設會先「思考」再回答，發言不需要，關掉以節省 token；gpt-oss 無法關閉，只能調低
function reasoningParams(model: string) {
  if (model.startsWith("qwen/")) return { reasoning_effort: "none" };
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low" };
  return {};
}

// retryAfterMs：額度不足（429）時 Groq 建議多久後再試；每分鐘額度通常幾秒內恢復，每日額度要等很久
export type SpeechResult = { text: string } | { error: string; status: number; retryAfterMs?: number };

// 從標頭 retry-after（秒）或錯誤訊息「try again in 7m53.04s」讀出等待時間
function retryAfter(res: Response, message: string): number | undefined {
  const header = Number(res.headers.get("retry-after"));
  if (header > 0) return header * 1000;
  const m = message.match(/try again in (?:(\d+)m)?([\d.]+)s/);
  return m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 : undefined;
}

export async function generateSpeech(req: SpeechRequest, key: string, model = DEFAULT_MODEL): Promise<SpeechResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: buildMessages(req),
        temperature: 0.9,
        max_tokens: 220,
        ...reasoningParams(model),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: "Groq 連線逾時", status: 504 };
  }

  // 429 代表 Groq 額度用完，呼叫端會改用罐頭台詞
  if (!res.ok) {
    if (res.status !== 429) return { error: `Groq 回應 ${res.status}`, status: 502 };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = body.error?.message ?? "";
    const limit = /tokens per day|requests per day/.test(message) ? "每日額度用完" : "每分鐘額度不足";
    return { error: `Groq 429（${limit}）`, status: 429, retryAfterMs: retryAfter(res, message) };
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = cleanSpeech(toTraditional(data.choices?.[0]?.message?.content ?? ""));
  return text ? { text } : { error: "模型沒有回應內容", status: 502 };
}
