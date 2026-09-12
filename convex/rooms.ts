import { ConvexError, v } from "convex/values";
import { BOARD, createGame, ROLE_NAME, SEAT_COUNT, type GameState, type Role, type Seat } from "../src/engine";
import { buildSeats, phaseKeyOf, shuffle } from "../src/sim/timing";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { commit, REVEAL_MS } from "./flow";

// 房號排除易混淆字元（0/O、1/I/L）
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROLES: Role[] = ["werewolf", "villager", "seer", "witch", "hunter", "guard"];

const fail = (message: string): never => {
  throw new ConvexError(message);
};

function cleanName(name: string) {
  const trimmed = name.trim().slice(0, 8);
  return trimmed || fail("請輸入暱稱");
}

function checkPlayerId(playerId: string) {
  if (playerId.length < 8 || playerId.length > 64) fail("裝置識別碼格式錯誤");
}

async function roomByCode(ctx: QueryCtx, code: string) {
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code.toUpperCase()))
    .unique();
}

async function mustRoom(ctx: MutationCtx, code: string) {
  return (await roomByCode(ctx, code)) ?? fail("找不到這個房間");
}

function mustHost(room: Doc<"rooms">, playerId: string) {
  if (room.hostPid !== playerId) fail("只有房主可以這麼做");
  if (room.status !== "lobby") fail("遊戲進行中");
}

// 移除某位玩家的指定角色
function unassign(assigned: Doc<"rooms">["assigned"], id: string) {
  return Object.fromEntries(Object.entries(assigned).filter(([key]) => key !== id));
}

const randomId = (length: number, chars = "abcdefghijklmnopqrstuvwxyz0123456789") =>
  Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");

// 等待室資料：只回傳公開 id，別人的 playerId 不外流
export const get = query({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await roomByCode(ctx, code);
    if (!room) return null;
    const me = room.members.find((m) => m.pid === playerId);
    const isHost = room.hostPid === playerId;
    const game = room.gameId ? await ctx.db.get(room.gameId) : null;
    return {
      code: room.code,
      status: room.status,
      isHost,
      youId: me?.id ?? null,
      members: room.members.map((m) => ({ id: m.id, name: m.name, host: m.pid === room.hostPid })),
      assigned: isHost ? room.assigned : {},
      // 自己是否在目前這局裡（遊戲進行中時用來決定要不要跳轉到遊戲畫面）
      inGame: !!game?.humans.some((h) => h.pid === playerId),
    };
  },
});

export const create = mutation({
  args: { playerId: v.string(), name: v.string() },
  handler: async (ctx, { playerId, name }) => {
    checkPlayerId(playerId);
    const member = { pid: playerId, id: randomId(6), name: cleanName(name), joinedAt: Date.now() };
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomId(4, CODE_CHARS);
      if (await roomByCode(ctx, code)) continue;
      await ctx.db.insert("rooms", { code, status: "lobby", hostPid: playerId, members: [member], assigned: {}, updatedAt: Date.now() });
      return code;
    }
    return fail("暫時無法建立房間，請再試一次");
  },
});

export const join = mutation({
  args: { code: v.string(), playerId: v.string(), name: v.string() },
  handler: async (ctx, { code, playerId, name }) => {
    checkPlayerId(playerId);
    const room = await mustRoom(ctx, code);
    const clean = cleanName(name);
    const existing = room.members.find((m) => m.pid === playerId);
    if (existing) {
      if (existing.name !== clean) {
        await ctx.db.patch(room._id, { members: room.members.map((m) => (m.pid === playerId ? { ...m, name: clean } : m)) });
      }
      return;
    }
    if (room.status !== "lobby") fail("遊戲已經開始，請等下一局");
    if (room.members.length >= SEAT_COUNT) fail("房間已滿");
    await ctx.db.patch(room._id, {
      members: [...room.members, { pid: playerId, id: randomId(6), name: clean, joinedAt: Date.now() }],
      updatedAt: Date.now(),
    });
  },
});

// 離開等待室；房主離開時轉交給最早加入的真人
export const leave = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await roomByCode(ctx, code);
    if (!room || room.status !== "lobby") return;
    const leaving = room.members.find((m) => m.pid === playerId);
    if (!leaving) return;
    const members = room.members.filter((m) => m.pid !== playerId);
    if (!members.length) {
      await ctx.db.patch(room._id, { members, updatedAt: Date.now() });
      return;
    }
    const assigned = unassign(room.assigned, leaving.id);
    const hostPid = room.hostPid === playerId ? [...members].sort((a, b) => a.joinedAt - b.joinedAt)[0].pid : room.hostPid;
    await ctx.db.patch(room._id, { members, assigned, hostPid, updatedAt: Date.now() });
  },
});

export const kick = mutation({
  args: { code: v.string(), playerId: v.string(), targetId: v.string() },
  handler: async (ctx, { code, playerId, targetId }) => {
    const room = await mustRoom(ctx, code);
    mustHost(room, playerId);
    const target = room.members.find((m) => m.id === targetId);
    if (!target || target.pid === room.hostPid) return;
    const assigned = unassign(room.assigned, targetId);
    await ctx.db.patch(room._id, { members: room.members.filter((m) => m.id !== targetId), assigned, updatedAt: Date.now() });
  },
});

// 房主指定角色（練習用）；指定的組合不能超過板子數量
export const assign = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    targetId: v.string(),
    role: v.union(v.literal("werewolf"), v.literal("villager"), v.literal("seer"), v.literal("witch"), v.literal("hunter"), v.literal("guard"), v.null()),
  },
  handler: async (ctx, { code, playerId, targetId, role }) => {
    const room = await mustRoom(ctx, code);
    mustHost(room, playerId);
    if (!room.members.some((m) => m.id === targetId)) fail("找不到這位玩家");
    const assigned = unassign(room.assigned, targetId);
    if (role) {
      const taken = Object.values(assigned).filter((r) => r === role).length;
      if (taken >= BOARD[role]) fail(`${ROLE_NAME[role]}最多 ${BOARD[role]} 位`);
      assigned[targetId] = role;
    }
    await ctx.db.patch(room._id, { assigned });
  },
});

// 開始：真人隨機入座、空位由 AI 補滿 12 人、分配身份，進入第 1 夜
export const start = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await mustRoom(ctx, code);
    mustHost(room, playerId);

    const seats = shuffle(Array.from({ length: SEAT_COUNT }, (_, i) => i + 1));
    const humans = room.members.map((m, i) => ({ seat: seats[i], pid: m.pid }));
    const assigned: Partial<Record<Seat, Role>> = {};
    room.members.forEach((m, i) => {
      const role = room.assigned[m.id];
      if (role && ROLES.includes(role)) assigned[seats[i]] = role;
    });

    // 發牌：真人拿到和上一局一樣的角色時重新發（最多 6 次，取重複最少的一次）；房主指定的角色不算
    const repeats = (s: GameState) =>
      room.members.filter((m, i) => !room.assigned[m.id] && room.lastRoles?.[m.id] === s.players[seats[i] - 1].role).length;
    let state = createGame({ seed: Math.floor(Math.random() * 2 ** 32), assigned });
    for (let attempt = 0; attempt < 6 && repeats(state) > 0; attempt++) {
      const next = createGame({ seed: Math.floor(Math.random() * 2 ** 32), assigned });
      if (repeats(next) < repeats(state)) state = next;
    }
    const lastRoles = Object.fromEntries(room.members.map((m, i) => [m.id, state.players[seats[i] - 1].role]));
    const meta = buildSeats(new Map(room.members.map((m, i) => [seats[i], m.name])));
    const now = Date.now();
    const gameId = await ctx.db.insert("games", {
      roomId: room._id,
      state: JSON.stringify(state),
      meta,
      humans,
      phaseKey: "",
      deadline: null,
      startsAt: now + REVEAL_MS,
    });
    for (const h of humans) await ctx.db.insert("presence", { gameId, seat: h.seat, lastSeen: now });
    await ctx.db.patch(room._id, { status: "playing", gameId, lastRoles, updatedAt: now });

    // phaseKey 設為空字串，commit 會把第一個夜晚步驟的計時與 AI 行動排程好
    const game = (await ctx.db.get(gameId))!;
    await commit(ctx, game, state);
    return phaseKeyOf(state);
  },
});
