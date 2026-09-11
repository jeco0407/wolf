import { EngineError, reduce, type Action, type GameState, type Seat } from "../src/engine";
import { botActions } from "../src/sim/bots";
import { botDelay, DURATION, phaseKeyOf } from "../src/sim/timing";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// 連線對局的「伺服器」流程：取代本機模擬的 LocalGame（計時、驅動 AI）。
// 每次狀態改變都走 commit()：階段一變就重設計時器，並替 AI 座位排程行動。

export const OFFLINE_MS = 30_000;
// 身份揭曉的緩衝時間：開局後這段時間內第一個夜晚步驟不開始計時
export const REVEAL_MS = 12_000;

export const loadState = (game: Doc<"games">) => JSON.parse(game.state) as GameState;

export function seatOf(game: Doc<"games">, playerId: string): Seat | null {
  return game.humans.find((h) => h.pid === playerId)?.seat ?? null;
}

// 由 AI 操作的座位：AI 補位的座位，以及斷線超過 30 秒的真人
export async function aiSeats(ctx: QueryCtx, game: Doc<"games">): Promise<Set<Seat>> {
  const now = Date.now();
  const seats = new Set<Seat>(game.meta.filter((m) => !m.isUser).map((m) => m.seat));
  for (const h of game.humans) {
    const p = await ctx.db
      .query("presence")
      .withIndex("by_game", (q) => q.eq("gameId", game._id).eq("seat", h.seat))
      .unique();
    const lastSeen = p?.lastSeen ?? game.startsAt;
    if (now - lastSeen > OFFLINE_MS) seats.add(h.seat);
  }
  return seats;
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
  for (const seat of await aiSeats(ctx, game)) {
    if (!botActions(state, seat).length) continue;
    const delay = start - now + botDelay(phase);
    const speaking = (phase.kind === "speech" || phase.kind === "lastWords") && phase.seat === seat;
    const args = { gameId: game._id, seat, phaseKey: key };
    if (speaking) await ctx.scheduler.runAfter(delay, internal.ai.speak, args);
    else await ctx.scheduler.runAfter(delay, internal.games.botAct, args);
  }
}
