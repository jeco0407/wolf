export const AVATAR_COUNT = 24;

export const avatarUrl = (n: number) => `/avatars/${String(n).padStart(2, "0")}.jpeg`;

// 每局開始時從頭像池不重複隨機抽 count 張（Fisher–Yates）；rng 可注入以便測試與重現
export function drawAvatars(count: number, rng: () => number = Math.random): string[] {
  const pool = Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map(avatarUrl);
}
