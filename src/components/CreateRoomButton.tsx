"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getPlayerId } from "@/lib/player";
import { hasConvex } from "./ConvexClientProvider";

const className =
  "btn-primary flex h-14 w-full items-center justify-center rounded-xl font-serif text-lg font-black tracking-widest disabled:opacity-60";

export function CreateRoomButton({ name }: { name: string }) {
  if (!hasConvex) {
    return (
      <button disabled className={className}>
        連線功能尚未設定
      </button>
    );
  }
  return <Create name={name} />;
}

// 只有設定了 Convex 才會掛載（useMutation 需要 ConvexProvider）
function Create({ name }: { name: string }) {
  const router = useRouter();
  const create = useMutation(api.rooms.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        disabled={busy}
        className={className}
        onClick={async () => {
          if (!name.trim()) {
            setError("請先輸入暱稱");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const code = await create({ playerId: getPlayerId(), name });
            router.push(`/room/${code}`);
          } catch (e) {
            setError(e instanceof ConvexError ? String(e.data) : "連線失敗，請稍後再試");
            setBusy(false);
          }
        }}
      >
        {busy ? "建立中…" : "建立房間"}
      </button>
      {error && <p className="mt-1 text-center text-sm text-blood">{error}</p>}
    </div>
  );
}
