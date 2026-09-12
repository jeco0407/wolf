"use node";

import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { v } from "convex/values";
import { identityOf, roomName, type VoiceChannel } from "../src/voice/permissions";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";

// 即時語音（LiveKit Cloud）。key 只存在 Convex 環境變數：LIVEKIT_URL、LIVEKIT_API_KEY、LIVEKIT_API_SECRET。
// 權限由伺服器決定（src/voice/permissions.ts）：token 簽發時給一次，之後每次換階段由 syncPermissions 更新

function config() {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  return url && key && secret ? { url, key, secret } : null;
}

const channel = v.union(v.literal("main"), v.literal("wolves"));

const grant = (canPublish: boolean) => ({
  canSubscribe: true,
  canPublish,
  canPublishData: false,
  canPublishSources: [TrackSource.MICROPHONE],
});

// 簽發加入語音頻道的 token；不在這局、不能加入這個頻道（例如非狼人要進狼隊頻道）或沒設定 LiveKit 時回傳 null
export const token = action({
  args: { code: v.string(), playerId: v.string(), channel },
  handler: async (ctx, args): Promise<{ url: string; token: string } | null> => {
    const cfg = config();
    if (!cfg) return null;
    const info = await ctx.runQuery(internal.games.voiceContext, args);
    if (!info) return null;
    const at = new AccessToken(cfg.key, cfg.secret, { identity: identityOf(info.seat), name: info.name, ttl: "3h" });
    at.addGrant({ room: roomName(info.gameId, args.channel as VoiceChannel), roomJoin: true, ...grant(info.canPublish) });
    return { url: cfg.url, token: await at.toJwt() };
  },
});

// 換階段時同步所有在線真人的發言權限（例如輪到下一位發言、天黑後全體閉麥）
export const syncPermissions = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const cfg = config();
    if (!cfg) return;
    const rooms = await ctx.runQuery(internal.games.voicePermissions, { gameId });
    if (!rooms) return;
    const service = new RoomServiceClient(cfg.url.replace(/^ws/, "http"), cfg.key, cfg.secret);
    for (const { channel: ch, seats } of rooms) {
      const room = roomName(gameId, ch);
      let present: Set<string>;
      try {
        present = new Set((await service.listParticipants(room)).map((p) => p.identity));
      } catch {
        continue; // 還沒有人加入這個頻道
      }
      for (const { seat, canPublish } of seats) {
        const identity = identityOf(seat);
        if (!present.has(identity)) continue;
        try {
          await service.updateParticipant(room, identity, { permission: grant(canPublish) });
        } catch (e) {
          console.warn(`更新語音權限失敗：${room} ${identity}`, e);
        }
      }
    }
  },
});
