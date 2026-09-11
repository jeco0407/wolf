type Recognition = {
  lang: string;
  interimResults: boolean;
  start(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};

// 瀏覽器語音轉文字（zh-TW）。不支援時回傳 false，由呼叫端改用文字輸入
export function listen(onText: (text: string) => void, onEnd: () => void): boolean {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) return false;
  const r = new SR();
  r.lang = "zh-TW";
  r.interimResults = false;
  r.onresult = (e) => onText(e.results[0][0].transcript);
  r.onend = onEnd;
  r.start();
  return true;
}
