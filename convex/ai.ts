import { v } from "convex/values";
import { DEFAULT_MODEL, generateSpeech } from "../src/ai/groq";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// 每分鐘額度不足時，Groq 通常幾秒內恢復：等一下再試，而不是直接換成罐頭台詞
const MAX_RETRY_WAIT_MS = 20_000;

// AI 發言：呼叫 Groq（key 只存在 Convex 環境變數 GROQ_API_KEY），失敗時交給 applySpeech 改用罐頭台詞
export const speak = internalAction({
  args: { gameId: v.id("games"), phaseKey: v.string(), seat: v.number() },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.games.speechContext, args);
    if (!request) return;
    const key = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
    let result = key ? await generateSpeech(request, key, model) : null;
    const wait = result && "error" in result ? result.retryAfterMs : undefined;
    if (key && wait !== undefined && wait <= MAX_RETRY_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, wait + 500));
      result = await generateSpeech(request, key, model);
    }
    if (result && "error" in result) console.warn(`AI 發言失敗：${result.error}`);
    await ctx.runMutation(internal.games.applySpeech, { ...args, text: result && "text" in result ? result.text : null });
  },
});
