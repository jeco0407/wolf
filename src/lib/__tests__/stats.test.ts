import { beforeEach, describe, expect, it } from "vitest";
import { clearRecords, getRecords, rate, recordGame, summarize } from "../stats";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe("戰績", () => {
  beforeEach(() => clearRecords());

  it("同一局只記一次，並依角色判斷勝負", () => {
    recordGame({ id: "a", role: "werewolf", winner: "wolf", survived: true, days: 4 });
    recordGame({ id: "a", role: "werewolf", winner: "wolf", survived: true, days: 4 });
    recordGame({ id: "b", role: "seer", winner: "wolf", survived: false, days: 3 });
    expect(getRecords().map((r) => [r.id, r.won])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(JSON.parse(store.get("ww:stats")!)).toHaveLength(2);
  });

  it("統計勝率、陣營與連勝", () => {
    for (const [id, role, winner] of [
      ["1", "villager", "good"],
      ["2", "witch", "good"],
      ["3", "werewolf", "good"],
      ["4", "werewolf", "wolf"],
    ] as const) {
      recordGame({ id, role, winner, survived: true, days: 3 });
    }
    const s = summarize(getRecords());
    expect(s.games).toBe(4);
    expect(rate(s)).toBe(75);
    expect(s.byTeam.good).toEqual({ games: 2, wins: 2 });
    expect(s.byTeam.wolf).toEqual({ games: 2, wins: 1 });
    expect(s.byRole.werewolf).toEqual({ games: 2, wins: 1 });
    expect([s.streak, s.bestStreak]).toEqual([1, 2]);
  });
});
