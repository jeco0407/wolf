"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { SceneBackground } from "@/components/SceneBackground";
import {
  getAudioSettings,
  getServerAudioSettings,
  playSfx,
  say,
  subscribeAudioSettings,
  unlockAudio,
  updateAudioSettings,
  type AudioSettings,
} from "@/voice/audio";

const TOGGLES: { key: Exclude<keyof AudioSettings, "volume" | "ttsRate">; label: string; hint: string }[] = [
  { key: "judgeVoice", label: "法官語音播報", hint: "天黑請閉眼、天亮公布死訊、投票結果" },
  { key: "aiVoice", label: "AI 發言自動朗讀", hint: "開啟時會等 AI 念完才換下一位" },
  { key: "sfx", label: "音效", hint: "翻牌、鐘聲、狼嚎、倒數、槍聲等" },
  { key: "bgm", label: "背景音樂", hint: "夜晚、白天、結算各一首" },
];

export default function Settings() {
  const s = useSyncExternalStore(subscribeAudioSettings, getAudioSettings, getServerAudioSettings);

  const preview = () => {
    unlockAudio();
    void playSfx("bell");
    void say("天黑請閉眼。守衛請睜眼。", { kind: "judge", force: true });
    void say("我是 5 號，昨晚平安夜，我先聽聽大家怎麼說。", { kind: "ai", voice: { pitch: 1.1, rate: 0.9 }, force: true });
  };

  return (
    <main className="relative isolate min-h-dvh px-4 pt-safe pb-safe">
      <SceneBackground isNight fixed />
      <header className="flex items-center gap-3 py-3">
        <Link href="/" className="text-mist">
          ←
        </Link>
        <h1 className="font-serif text-2xl font-black tracking-widest">設定</h1>
      </header>

      <section className="panel divide-y divide-gold/10 rounded-2xl px-4">
        {TOGGLES.map((t) => (
          <div key={t.key} className="flex min-h-16 items-center justify-between gap-3 py-2">
            <div>
              <div className="text-sm">{t.label}</div>
              <div className="text-[11px] text-mist">{t.hint}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={s[t.key]}
              aria-label={t.label}
              onClick={() => updateAudioSettings({ [t.key]: !s[t.key] })}
              className={`h-7 w-12 shrink-0 rounded-full p-0.5 transition ${s[t.key] ? "bg-blood" : "bg-panel-2"}`}
            >
              <span className={`block h-6 w-6 rounded-full bg-moon transition ${s[t.key] ? "translate-x-5" : ""}`} />
            </button>
          </div>
        ))}
        <label className="flex min-h-16 items-center gap-3 py-2 text-sm">
          音量
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onChange={(e) => updateAudioSettings({ volume: Number(e.target.value) })}
            className="flex-1 accent-[#b3122e]"
          />
          <span className="w-10 text-right text-xs text-mist">{Math.round(s.volume * 100)}%</span>
        </label>
        <label className="flex min-h-16 items-center gap-3 py-2 text-sm">
          朗讀速度
          <input
            type="range"
            min={0.8}
            max={1.2}
            step={0.05}
            value={s.ttsRate}
            onChange={(e) => updateAudioSettings({ ttsRate: Number(e.target.value) })}
            className="flex-1 accent-[#b3122e]"
          />
          <span className="w-10 text-right text-xs text-mist">{s.ttsRate.toFixed(2)}×</span>
        </label>
      </section>

      <button type="button" onClick={preview} className="panel mt-3 flex h-14 w-full items-center justify-between rounded-2xl px-4 text-sm">
        🔔 試聽法官、AI 朗讀與音效<span className="text-mist">›</span>
      </button>
      <p className="mt-3 text-xs text-mist">指定角色改由房主在等待室設定。</p>
    </main>
  );
}
