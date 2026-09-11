// mulberry32：狀態存在 GameState 裡，確保同樣的操作序列得到同樣的結果（Convex mutation 需要確定性）
export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(next ^ (next >>> 15), 1 | next);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next];
}
