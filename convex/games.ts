import { v } from "convex/values";
import { buildSpeechRequest } from "../src/ai/speech";
import { EngineError, reduce, viewFor, type Action } from "../src/engine";
import { botActions } from "../src/sim/bots";
import { readMs } from "../src/sim/timing";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { applyAll, commit, loadState, seatOf } from "./flow";

async function gameFor(ctx: QueryCtx, code: string) {
  const room = await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (!room?.gameId) return null;
  return await ctx.db.get(room.gameId);
}

// 自己的視角（防作弊核心）：完整 GameState 絕不下發，只回傳 viewFor 過濾後的資料。
// 不在這局裡的人（包括拿到連結的旁觀者）什麼都拿不到，避免開第二個裝置偷看
export const view = query({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const game = await gameFor(ctx, code);
    if (!game) return null;
    const seat = seatOf(game, playerId);
    if (seat === null) return { gameId: game._id, member: false as const };
    const state = loadState(game);
    return {
      gameId: game._id,
      member: true as const,
      seat,
      view: viewFor(state, seat),
      meta: game.meta,
      deadline: game.deadline,
      startsAt: game.startsAt,
      voted: state.votes[seat] !== undefined,
    };
  },
});

// 送出行動：座位一律由 playerId 決定，前端送來的 seat 會被覆蓋；timeout 只有伺服器能送
const PLAYER_ACTIONS = new Set(["guard", "wolfVote", "wolfChat", "witch", "seerCheck", "say", "endSpeech", "vote", "shoot"]);

export const act = mutation({
  args: { code: v.string(), playerId: v.string(), action: v.any() },
  handler: async (ctx, { code, playerId, action }): Promise<string | null> => {
    const game = await gameFor(ctx, code);
    if (!game) return "找不到這場遊戲";
    const seat = seatOf(game, playerId);
    if (seat === null) return "你不在這場遊戲中";
    if (typeof action !== "object" || action === null || !PLAYER_ACTIONS.has(action.type)) return "不支援的行動";
    if ((action.type === "say" || action.type === "wolfChat") && (typeof action.text !== "string" || action.text.length > 500)) {
      return "發言太長";
    }
    try {
      await commit(ctx, game, reduce(loadState(game), { ...action, seat } as Action));
    } catch (e) {
      if (e instanceof EngineError) return e.message;
      throw e;
    }
    return null;
  },
});

// 真人心跳（前端每 10 秒一次）：超過 30 秒沒有心跳就由 AI 接管，重連後自動拿回控制權
export const heartbeat = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const game = await gameFor(ctx, code);
    if (!game) return;
    const seat = seatOf(game, playerId);
    if (seat === null) return;
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_game", (q) => q.eq("gameId", game._id).eq("seat", seat))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { lastSeen: Date.now() });
    else await ctx.db.insert("presence", { gameId: game._id, seat, lastSeen: Date.now() });
  },
});

// ---- 伺服器內部：計時與 AI ----

const phaseArgs = { gameId: v.id("games"), phaseKey: v.string() };

async function current(ctx: QueryCtx, gameId: Id<"games">, phaseKey: string) {
  const game = await ctx.db.get(gameId);
  // 階段已經改變（行動過期），什麼都不做
  return game && game.phaseKey === phaseKey ? game : null;
}

export const tick = internalMutation({
  args: phaseArgs,
  handler: async (ctx, { gameId, phaseKey }) => {
    const game = await current(ctx, gameId, phaseKey);
    if (game) await commit(ctx, game, applyAll(loadState(game), [{ type: "timeout" }]));
  },
});

export const botAct = internalMutation({
  args: { ...phaseArgs, seat: v.number() },
  handler: async (ctx, { gameId, phaseKey, seat }) => {
    const game = await current(ctx, gameId, phaseKey);
    if (!game) return;
    const state = loadState(game);
    await commit(ctx, game, applyAll(state, botActions(state, seat)));
  },
});

// AI 發言：先給 LLM 需要的摘要（只含這個 AI 自己的視角）
export const speechContext = internalQuery({
  args: { ...phaseArgs, seat: v.number() },
  handler: async (ctx, { gameId, phaseKey, seat }) => {
    const game = await current(ctx, gameId, phaseKey);
    if (!game) return null;
    const state = loadState(game);
    const style = game.meta[seat - 1].style ?? "";
    return buildSpeechRequest(state, seat, game.meta.map((m) => m.name), style);
  },
});

// 拿到 LLM 內容就先顯示，依字數停留後才結束發言；text 為 null（沒有 key、額度用完）時用罐頭台詞
export const applySpeech = internalMutation({
  args: { ...phaseArgs, seat: v.number(), text: v.union(v.string(), v.null()) },
  handler: async (ctx, { gameId, phaseKey, seat, text }) => {
    const game = await current(ctx, gameId, phaseKey);
    if (!game) return;
    const state = loadState(game);
    const canned = botActions(state, seat).find((a) => a.type === "say");
    const content = text ?? (canned?.type === "say" ? canned.text : "");
    await commit(ctx, game, applyAll(state, [{ type: "say", seat, text: content }]));
    await ctx.scheduler.runAfter(readMs(content), internal.games.endSpeech, { gameId, phaseKey, seat });
  },
});

export const endSpeech = internalMutation({
  args: { ...phaseArgs, seat: v.number() },
  handler: async (ctx, { gameId, phaseKey, seat }) => {
    const game = await current(ctx, gameId, phaseKey);
    if (game) await commit(ctx, game, applyAll(loadState(game), [{ type: "endSpeech", seat }]));
  },
});
