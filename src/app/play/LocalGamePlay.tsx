"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { requestSpeech } from "@/ai/client";
import { GameScreen, type GameController } from "@/components/GameScreen";
import { viewFor } from "@/engine";
import { readNickname } from "@/lib/player";
import { getRecords } from "@/lib/stats";
import { LocalGame } from "@/sim/localGame";
import { say } from "@/voice/audio";

// 本機模擬：LocalGame 在瀏覽器裡擔任伺服器
export default function LocalGamePlay({ onRestart }: { onRestart: () => void }) {
  const [game] = useState(
    () =>
      new LocalGame(
        readNickname("你"),
        requestSpeech,
        (_seat, text, voice) => say(text, { kind: "ai", voice }),
        getRecords().at(-1)?.role,
      ),
  );
  // 開發模式會先卸載再掛載一次：掛載時 resume，真正卸載時才 destroy
  useEffect(() => {
    game.resume();
    return () => game.destroy();
  }, [game]);

  const snap = useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
  const controller = useMemo<GameController>(
    () => ({
      id: game.id,
      view: viewFor(snap.state, game.userSeat),
      meta: game.meta,
      deadline: snap.deadline,
      voted: snap.state.votes[game.userSeat] !== undefined,
      started: snap.started,
      start: () => game.start(),
      dispatch: game.dispatch,
      speed: snap.speed,
      setSpeed: (n) => game.setSpeed(n),
    }),
    [snap, game],
  );

  return <GameScreen game={controller} onRestart={onRestart} />;
}
