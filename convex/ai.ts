import { v } from "convex/values";
import { DEFAULT_MODEL, generateSpeech } from "../src/ai/groq";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// AI 發言：呼叫 Groq（key 只存在 Convex 環境變數 GROQ_API_KEY），失敗時交給 applySpeech 改用罐頭台詞
export const speak = internalAction({
  args: { gameId: v.id("games"), phaseKey: v.string(), seat: v.number() },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.games.speechContext, args);
    if (!request) return;
    const key = process.env.GROQ_API_KEY;
    const result = key ? await generateSpeech(request, key, process.env.GROQ_MODEL || DEFAULT_MODEL) : null;
    if (result && "error" in result) console.warn(`AI 發言失敗：${result.error}`);
    await ctx.runMutation(internal.games.applySpeech, { ...args, text: result && "text" in result ? result.text : null });
  },
});
