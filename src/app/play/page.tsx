"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

// 對局用到隨機座位、身份與 localStorage，只在瀏覽器端渲染
const LocalGamePlay = dynamic(() => import("./LocalGamePlay"), { ssr: false });

export default function PlayPage() {
  const [round, setRound] = useState(0);
  return <LocalGamePlay key={round} onRestart={() => setRound((r) => r + 1)} />;
}
