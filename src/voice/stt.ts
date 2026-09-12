type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};

export interface Listener {
  stop(): void;
}

// 瀏覽器語音轉文字（zh-TW），連續辨識直到呼叫 stop()。
// 每段確定的文字會交給 onText（寫進發言，讓 AI 看得懂真人說了什麼）。不支援時回傳 null，由呼叫端改用文字輸入
export function listen(onText: (text: string) => void, onEnd: () => void): Listener | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "zh-TW";
  r.interimResults = false;
  r.continuous = true;
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) onText(e.results[i][0].transcript);
    }
  };
  r.onend = onEnd;
  try {
    r.start();
  } catch {
    return null;
  }
  return { stop: () => r.stop() };
}
