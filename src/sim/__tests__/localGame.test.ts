import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botActions } from "../bots";
import { LocalGame, type SpeechProvider } from "../localGame";

async function playToEnd(game: LocalGame) {
  game.start();
  for (let tick = 0; tick < 3000 && game.getSnapshot().state.phase.kind !== "ended"; tick++) {
    // 真人座位也交給 AI 代打；重複或過期的行動會被引擎拒絕，忽略即可
    for (const action of botActions(game.getSnapshot().state, game.userSeat)) game.dispatch(action);
    await vi.advanceTimersByTimeAsync(1000);
  }
}

describe("本機模擬", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("12 個座位都交給 AI，每局都能跑到結束", async () => {
    for (let round = 0; round < 20; round++) {
      const game = new LocalGame("測試");
      await playToEnd(game);
      expect(game.getSnapshot().state.phase.kind).toBe("ended");
      game.destroy();
    }
  });

  it("AI 發言使用 LLM 回傳的內容，失敗時改用罐頭台詞", async () => {
    let calls = 0;
    const speech: SpeechProvider = async () => (++calls % 2 ? "這是 LLM 的發言" : null);
    const game = new LocalGame("測試", speech);
    await playToEnd(game);
    const speeches = game.getSnapshot().state.events.filter((e) => e.type === "speech");
    expect(game.getSnapshot().state.phase.kind).toBe("ended");
    expect(calls).toBeGreaterThan(0);
    expect(speeches.some((e) => e.type === "speech" && e.text === "這是 LLM 的發言")).toBe(true);
    expect(speeches.some((e) => e.type === "speech" && e.text !== "這是 LLM 的發言")).toBe(true);
  });

  it("LLM 回應太慢時，不會在階段結束後才發言", async () => {
    const speech: SpeechProvider = () => new Promise((resolve) => setTimeout(() => resolve("太晚了"), 200_000));
    const game = new LocalGame("測試", speech);
    await playToEnd(game);
    const late = game.getSnapshot().state.events.filter((e) => e.type === "speech" && e.text === "太晚了");
    expect(late).toHaveLength(0);
  });

  it("卸載後重新掛載（React 開發模式），AI 仍會發言", async () => {
    const speech: SpeechProvider = async () => "重新掛載後的發言";
    const game = new LocalGame("測試", speech);
    game.destroy();
    game.resume();
    await playToEnd(game);
    const state = game.getSnapshot().state;
    expect(state.phase.kind).toBe("ended");
    expect(state.events.some((e) => e.type === "speech" && e.text === "重新掛載後的發言")).toBe(true);
  });

  it("真人不行動時，階段會依時限自動推進", () => {
    const game = new LocalGame("測試");
    game.start();
    const { day } = game.getSnapshot().state;
    vi.advanceTimersByTime(4 * 6000 + 100);
    const { state } = game.getSnapshot();
    expect(state.day).toBe(day);
    expect(state.phase.kind).not.toBe("night");
    game.destroy();
  });

  it("開始前不計時", () => {
    const game = new LocalGame("測試");
    vi.advanceTimersByTime(60000);
    expect(game.getSnapshot()).toMatchObject({ started: false, deadline: null });
    expect(game.getSnapshot().state.phase).toEqual({ kind: "night", step: "guard" });
  });
});

describe("發牌", () => {
  it("避開上一局的角色：上一局是狼人，這局幾乎不會再是狼人", () => {
    let wolves = 0;
    for (let i = 0; i < 300; i++) {
      const game = new LocalGame("測試", undefined, undefined, "werewolf");
      if (game.getSnapshot().state.players[game.userSeat - 1].role === "werewolf") wolves++;
    }
    // 不避開時約 1/3（100 次）；重新發牌 6 次後約 (1/3)^7，300 局幾乎是 0
    expect(wolves).toBeLessThan(5);
  });
});
