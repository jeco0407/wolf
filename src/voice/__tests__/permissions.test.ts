import { describe, expect, it } from "vitest";
import type { GameState } from "@/engine";
import { canJoin, canSpeak, seatOfIdentity, identityOf } from "../permissions";

const roles = ["werewolf", "villager", "seer", "witch", "hunter", "guard", "werewolf", "villager", "werewolf", "villager", "werewolf", "villager"];

function state(phase: GameState["phase"], dead: number[] = []): GameState {
  return {
    phase,
    players: roles.map((role, i) => ({ seat: i + 1, role, alive: !dead.includes(i + 1) })),
  } as unknown as GameState;
}

describe("語音權限", () => {
  it("白天只有目前發言者能在全體頻道說話", () => {
    const s = state({ kind: "speech", seat: 3, pk: false } as GameState["phase"]);
    expect(canSpeak(s, 3, "main")).toBe(true);
    expect(canSpeak(s, 4, "main")).toBe(false);
    expect(canSpeak(s, 1, "wolves")).toBe(false);
  });

  it("遺言時出局的人也能說話", () => {
    const s = state({ kind: "lastWords", seat: 5 } as GameState["phase"], [5]);
    expect(canSpeak(s, 5, "main")).toBe(true);
  });

  it("狼隊頻道：只有狼人能加入，夜晚狼人行動時存活的狼能說話", () => {
    const s = state({ kind: "night", step: "wolf" } as GameState["phase"], [7]);
    expect(canJoin(s, 2, "wolves")).toBe(false);
    expect(canJoin(s, 7, "wolves")).toBe(true);
    expect(canSpeak(s, 1, "wolves")).toBe(true);
    expect(canSpeak(s, 7, "wolves")).toBe(false);
    expect(canSpeak(s, 2, "wolves")).toBe(false);
    expect(canSpeak(s, 1, "main")).toBe(false);
  });

  it("其他夜晚步驟與投票時沒有人能說話", () => {
    for (const phase of [{ kind: "night", step: "seer" }, { kind: "vote", pk: false }]) {
      const s = state(phase as GameState["phase"]);
      for (let seat = 1; seat <= 12; seat++) {
        expect(canSpeak(s, seat, "main")).toBe(false);
        expect(canSpeak(s, seat, "wolves")).toBe(false);
      }
    }
  });

  it("身份字串與座位互轉", () => {
    expect(seatOfIdentity(identityOf(11))).toBe(11);
    expect(seatOfIdentity("hacker")).toBeNull();
  });
});
