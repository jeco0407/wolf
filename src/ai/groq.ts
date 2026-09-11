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

export type SpeechResult = { text: string } | { error: string; status: number };

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
  if (!res.ok) return { error: `Groq 回應 ${res.status}`, status: res.status === 429 ? 429 : 502 };

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = cleanSpeech(toTraditional(data.choices?.[0]?.message?.content ?? ""));
  return text ? { text } : { error: "模型沒有回應內容", status: 502 };
}
