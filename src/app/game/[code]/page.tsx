"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

// 用到 localStorage 的 playerId，只在瀏覽器端渲染
const OnlineGame = dynamic(() => import("./OnlineGame"), { ssr: false });

export default function GamePage() {
  const { code } = useParams<{ code: string }>();
  return <OnlineGame code={code.toUpperCase()} />;
}
