import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(
  v.literal("werewolf"),
  v.literal("villager"),
  v.literal("seer"),
  v.literal("witch"),
  v.literal("hunter"),
  v.literal("guard"),
);

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    status: v.union(v.literal("lobby"), v.literal("playing")),
    // 房主的 playerId（秘密，不會回傳給前端）
    hostPid: v.string(),
    members: v.array(
      v.object({
        // pid：裝置的匿名 playerId，等同登入憑證，只存在伺服器；id：公開的短 id，用來踢人、指定角色
        pid: v.string(),
        id: v.string(),
        name: v.string(),
        joinedAt: v.number(),
      }),
    ),
    // 房主指定的角色：公開 id → 角色
    assigned: v.record(v.string(), role),
    gameId: v.optional(v.id("games")),
    updatedAt: v.number(),
  }).index("by_code", ["code"]),

  games: defineTable({
    roomId: v.id("rooms"),
    // 完整 GameState（JSON 字串）。只在伺服器端使用，前端只能透過 games.view 拿到自己的視角
    state: v.string(),
    meta: v.array(
      v.object({
        seat: v.number(),
        name: v.string(),
        avatar: v.string(),
        isUser: v.boolean(),
        style: v.optional(v.string()),
        voice: v.optional(v.object({ pitch: v.number(), rate: v.number() })),
      }),
    ),
    // 真人座位 → playerId
    humans: v.array(v.object({ seat: v.number(), pid: v.string() })),
    phaseKey: v.string(),
    deadline: v.union(v.number(), v.null()),
    timer: v.optional(v.id("_scheduled_functions")),
    // 身份揭曉的緩衝時間結束前，第一個夜晚步驟不開始計時
    startsAt: v.number(),
  }).index("by_room", ["roomId"]),

  // 真人心跳：超過 30 秒沒有心跳視為斷線，由 AI 接管
  presence: defineTable({
    gameId: v.id("games"),
    seat: v.number(),
    lastSeen: v.number(),
  }).index("by_game", ["gameId", "seat"]),
});
