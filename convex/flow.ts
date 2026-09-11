import { EngineError, reduce, type Action, type GameState, type Seat } from "../src/engine";
import { botActions } from "../src/sim/bots";
import { botDelay, DURATION, phaseKeyOf } from "../src/sim/timing";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// 連線對局的「伺服器」流程：取代本機模擬的 LocalGame（計時、驅動 AI）。
// 每次狀態改變都走 commit()：階段一變就重設計時器，並替 AI 座位排程行動。

export const OFFLINE_MS = 30_000;
// 所有真人都離線超過這段時間就暫停對局
export const PAUSE_MS = 5 * 60_000;
// 身份揭曉的緩衝時間：開局後這段時間內第一個夜晚步驟不開始計時
export const REVEAL_MS = 12_000;

export const loadState = (game: Doc<"games">) => JSON.parse(game.state) as GameState;

export function seatOf(game: Doc<"games">, playerId: string): Seat | null {
  return game.humans.find((h) => h.pid === playerId)?.seat ?? null;
}

// 由 AI 操作的座位（AI 補位的座位，以及斷線超過 30 秒的真人），以及最近一次有真人心跳的時間
export async function presenceOf(ctx: QueryCtx, game: Doc<"games">) {
  const now = Date.now();
  const aiSeats = new Set<Seat>(game.meta.filter((m) => !m.isUser).map((m) => m.seat));
  let lastHuman = 0;
  for (const h of game.humans) {
    const p = await ctx.db
      .query("presence")
      .withIndex("by_game", (q) => q.eq("gameId", game._id).eq("seat", h.seat))
      .unique();
    const lastSeen = p?.lastSeen ?? game.startsAt;
    lastHuman = Math.max(lastHuman, lastSeen);
    if (now - lastSeen > OFFLINE_MS) aiSeats.add(h.seat);
  }
  // 沒有真人在線（例如大家都關掉分頁）時，AI 改用罐頭台詞，不耗 Groq 額度
  return { aiSeats, anyoneOnline: now - lastHuman <= OFFLINE_MS, abandoned: now - lastHuman > PAUSE_MS };
}

// 依序套用行動；不合法（過期、重複）的行動直接略過
export function applyAll(state: GameState, actions: Action[]): GameState {
  for (const action of actions) {
    try {
      state = reduce(state, action);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
  }
  return state;
}

export async function commit(ctx: MutationCtx, game: Doc<"games">, state: GameState) {
  const key = phaseKeyOf(state);
  if (key === game.phaseKey) {
    await ctx.db.patch(game._id, { state: JSON.stringify(state) });
    return;
  }

  if (game.timer) {
    const pending = await ctx.db.system.get(game.timer);
    if (pending?.state.kind === "pending") await ctx.scheduler.cancel(game.timer);
  }
  const now = Date.now();
  const presence = await presenceOf(ctx, game);
  if (presence.abandoned && state.phase.kind !== "ended") {
    // 沒人在玩了：停在這個階段，不排計時與 AI；有人回來時 heartbeat 會呼叫 resume()
    await ctx.db.patch(game._id, { state: JSON.stringify(state), phaseKey: key, deadline: null, timer: undefined, paused: true });
    return;
  }
  const start = Math.max(now, game.startsAt);
  const ms = DURATION[state.phase.kind];
  const deadline = ms ? start + ms : null;
  const timer = deadline !== null ? await ctx.scheduler.runAt(deadline, internal.games.tick, { gameId: game._id, phaseKey: key }) : undefined;
  await ctx.db.patch(game._id, { state: JSON.stringify(state), phaseKey: key, deadline, timer });

  if (state.phase.kind === "ended") {
    // 遊戲結束：房間回到等待室（保留真人玩家），結算畫面仍可從 gameId 讀取
    await ctx.db.patch(game.roomId, { status: "lobby", updatedAt: now });
    return;
  }

  const phase = state.phase;
  for (const seat of presence.aiSeats) {
    if (!botActions(state, seat).length) continue;
    const delay = start - now + botDelay(phase);
    const speaking = (phase.kind === "speech" || phase.kind === "lastWords") && phase.seat === seat;
    const args = { gameId: game._id, seat, phaseKey: key };
    if (speaking && presence.anyoneOnline) await ctx.scheduler.runAfter(delay, internal.ai.speak, args);
    else await ctx.scheduler.runAfter(delay, internal.games.botAct, args);
  }
}

// 暫停的對局有真人回來：從目前階段重新計時、重新排 AI
export async function resume(ctx: MutationCtx, game: Doc<"games">) {
  await ctx.db.patch(game._id, { paused: false });
  const fresh = (await ctx.db.get(game._id))!;
  await commit(ctx, { ...fresh, phaseKey: "", timer: undefined }, loadState(fresh));
}
