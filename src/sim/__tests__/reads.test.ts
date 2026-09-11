import { describe, expect, it } from "vitest";
import type { GameEvent, GameView, Role, Seat } from "@/engine";
import { mostSuspicious, readTable } from "../reads";

const speech = (seat: Seat, text: string, day = 1) => ({ type: "speech", seat, text, kind: "speech", day }) as unknown as GameEvent;

function viewOf(seat: Seat, role: Role, events: GameEvent[], wolves: Seat[] = []): GameView {
  return {
    day: 2,
    phase: { kind: "vote" },
    omniscient: false,
    you: { seat, role, alive: true },
    players: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, alive: true, role: wolves.includes(i + 1) ? "werewolf" : undefined })),
    events,
    potions: null,
    lastGuard: null,
  } as unknown as GameView;
}

describe("盤邏輯", () => {
  it("解析跳預言家與查驗結果", () => {
    const reads = readTable(viewOf(9, "villager", [speech(2, "我是預言家，昨晚查驗 5 號，他是狼人，大家跟我投他。")]));
    expect(reads.claims.get(2)).toBe("seer");
    expect(reads.seerClaims).toEqual([{ seat: 2, target: 5, team: "wolf" }]);
    expect(reads.trustedSeer).toBe(2);
    expect(mostSuspicious(reads, [3, 4, 5, 6], 0)).toBe(5);
  });

  it("金水降低嫌疑，「不是狼」不算踩", () => {
    const reads = readTable(
      viewOf(9, "villager", [speech(2, "我是預言家，昨晚驗了 4 號，是金水。"), speech(3, "我覺得 6 號不是狼，7 號很可疑。")]),
    );
    expect(reads.score(4)).toBeLessThan(0);
    expect(reads.score(6)).toBeLessThan(0);
    expect(reads.score(7)).toBeGreaterThan(0);
  });

  it("被查殺的好人知道對方是假預言家", () => {
    const reads = readTable(viewOf(5, "villager", [speech(2, "我是預言家，查驗 5 號是狼人。")]));
    expect(reads.score(2)).toBeGreaterThanOrEqual(8);
    expect(reads.score(5)).toBe(0);
  });

  it("真預言家把對跳的人當狼，並相信自己的查驗", () => {
    const events = [
      speech(3, "我才是預言家，查驗 8 號是好人。"),
      { type: "seerResult", seat: 1, target: 10, team: "wolf", day: 1 } as unknown as GameEvent,
    ];
    const reads = readTable(viewOf(1, "seer", events));
    expect(mostSuspicious(reads, [3, 8, 10], 0)).toBe(10);
    expect(reads.score(3)).toBeGreaterThanOrEqual(8);
  });

  it("冒充自己神職身份的人會被當成狼", () => {
    const reads = readTable(viewOf(6, "witch", [speech(4, "我是女巫，昨晚救了人。")]));
    expect(reads.score(4)).toBeGreaterThanOrEqual(8);
  });
});
