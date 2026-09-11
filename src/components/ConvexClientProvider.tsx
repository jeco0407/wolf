"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

// 連線對局的即時後端；沒有設定 NEXT_PUBLIC_CONVEX_URL 時只能玩本機模擬（/play）
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;

export const hasConvex = client !== null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return client ? <ConvexProvider client={client}>{children}</ConvexProvider> : <>{children}</>;
}
