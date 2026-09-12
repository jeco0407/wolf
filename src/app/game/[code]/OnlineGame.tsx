"use client";

import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { GameScreen, type GameController } from "@/components/GameScreen";
import { SceneBackground } from "@/components/SceneBackground";
import type { Action } from "@/engine";
import { getPlayerId } from "@/lib/player";
import { useVoiceRoom } from "@/voice/livekit";
import { MIN_HUMANS_FOR_VOICE, type VoiceChannel } from "@/voice/permissions";

const HEARTBEAT_MS = 10_000;

const revealedKey = (gameId: string) => `ww:revealed:${gameId}`;
function wasRevealed(gameId: string) {
  try {
    return sessionStorage.getItem(revealedKey(gameId)) === "1";
  } catch {
    return false;
  }
}

// 連線對局：資料來自 Convex（games.view 只回傳自己的視角），行動送到 games.act 由伺服器驗證
export default function OnlineGame({ code }: { code: string }) {
  const router = useRouter();
  const [playerId] = useState(getPlayerId);
  const data = useQuery(api.games.view, { code, playerId });
  const act = useMutation(api.games.act);
  const heartbeat = useMutation(api.games.heartbeat);
  const [revealed, setRevealed] = useState<string | null>(null);

  // 心跳：斷線超過 30 秒由 AI 接管，回來後自動拿回控制權
  useEffect(() => {
    const beat = () => void heartbeat({ code, playerId }).catch(() => {});
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => document.visibilityState === "visible" && beat();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, playerId, heartbeat]);

  const gameId = data?.gameId ?? null;
  const started = gameId !== null && (revealed === gameId || wasRevealed(gameId));

  // 即時語音：至少兩位真人、翻完身份牌後才連線；狼人另外連狼隊頻道
  const getToken = useAction(api.livekit.token);
  const fetchToken = useCallback((channel: VoiceChannel) => getToken({ code, playerId, channel }), [getToken, code, playerId]);
  const humans = data?.member ? data.meta.filter((m) => m.isUser).length : 0;
  const voiceOn = started && humans >= MIN_HUMANS_FOR_VOICE;
  const isWolf = !!data?.member && data.view.you?.role === "werewolf";
  const main = useVoiceRoom("main", voiceOn, gameId ?? "", fetchToken);
  const wolves = useVoiceRoom("wolves", voiceOn && isWolf, gameId ?? "", fetchToken);

  const controller = useMemo<GameController | null>(() => {
    if (!data?.member) return null;
    return {
      id: data.gameId,
      view: data.view,
      meta: data.meta,
      deadline: data.deadline,
      voted: data.voted,
      started,
      start: () => {
        try {
          sessionStorage.setItem(revealedKey(data.gameId), "1");
        } catch {}
        setRevealed(data.gameId);
      },
      dispatch: async (action: Action) => {
        try {
          return await act({ code, playerId, action });
        } catch {
          return "連線中斷，請稍後再試";
        }
      },
      voice: voiceOn ? { main, wolves } : undefined,
      readAiSpeech: true,
    };
  }, [data, started, act, code, playerId, voiceOn, main, wolves]);

  if (data === undefined) return <Notice>連線中…</Notice>;
  if (data === null) {
    return (
      <Notice>
        找不到這場遊戲。
        <Link href={`/room/${code}`} className="mt-4 block text-gold underline">
          回到房間
        </Link>
      </Notice>
    );
  }
  if (!controller) {
    return (
      <Notice>
        這局已經開始，你不在這局裡。
        <Link href={`/room/${code}`} className="mt-4 block text-gold underline">
          回到房間等下一局
        </Link>
      </Notice>
    );
  }
  return <GameScreen key={data.gameId} game={controller} onRestart={() => router.push(`/room/${code}`)} />;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center px-6 text-center text-mist">
      <SceneBackground isNight fixed />
      <div>{children}</div>
    </main>
  );
}
