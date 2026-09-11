import { describe, expect, it } from "vitest";
import { EngineError } from "../machine";
import { resolveNight } from "../resolve";
import { createGame } from "../setup";
import { BOARD, type GameState, type Player, type Role } from "../types";
import { winnerOf } from "../victory";
import { viewFor } from "../visibility";
import {
  everyoneVotes,
  finishSpeeches,
  GUARD,
  HUNTER,
  newGame,
  playNight,
  run,
  SEER,
  skipDay,
  WITCH,
  WOLVES,
} from "./helpers";

const roleOf = (s: GameState, seat: number) => s.players.find((p) => p.seat === seat)!;

describe("開局", () => {
  it("依板子分配 12 個身份", () => {
    const s = createGame({ seed: 42 });
    const counts = s.players.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.role]: (acc[p.role] ?? 0) + 1 }), {});
    expect(counts).toEqual(BOARD);
  });

  it("同一個 seed 產生相同的身份", () => {
    expect(createGame({ seed: 7 }).players).toEqual(createGame({ seed: 7 }).players);
  });

  it("保留房主指定的角色", () => {
    const s = createGame({ seed: 3, assigned: { 5: "seer" } });
    expect(roleOf(s, 5).role).toBe("seer");
    expect(s.players.filter((p) => p.role === "seer")).toHaveLength(1);
  });

  it("指定超過板子數量會報錯", () => {
    expect(() => createGame({ seed: 1, assigned: { 1: "seer", 2: "seer" } })).toThrow(EngineError);
  });

  it("從第一夜的守衛開始", () => {
    const s = newGame();
    expect(s.day).toBe(1);
    expect(s.phase).toEqual({ kind: "night", step: "guard" });
  });
});

describe("夜晚結算", () => {
  it("沒人救，被刀者死亡", () => {
    expect(resolveNight({ knife: 5, guard: null, saved: false, poison: null })).toEqual([{ seat: 5, cause: "wolf" }]);
  });
  it("守衛守中，平安夜", () => {
    expect(resolveNight({ knife: 5, guard: 5, saved: false, poison: null })).toEqual([]);
  });
  it("女巫解救，平安夜", () => {
    expect(resolveNight({ knife: 5, guard: 6, saved: true, poison: null })).toEqual([]);
  });
  it("同守同救，仍然死亡", () => {
    expect(resolveNight({ knife: 5, guard: 5, saved: true, poison: null })).toEqual([{ seat: 5, cause: "wolf" }]);
  });
  it("被刀又被毒，死因算毒殺", () => {
    expect(resolveNight({ knife: 5, guard: null, saved: false, poison: 5 })).toEqual([{ seat: 5, cause: "poison" }]);
  });
  it("刀與毒不同人，兩人都死並依座位排序", () => {
    expect(resolveNight({ knife: 7, guard: null, saved: false, poison: 3 })).toEqual([
      { seat: 3, cause: "poison" },
      { seat: 7, cause: "wolf" },
    ]);
  });
});

describe("夜晚技能限制", () => {
  it("守衛不可連續兩晚守同一人", () => {
    let s = playNight(newGame(), { guard: 5, knife: 5 });
    s = skipDay(s);
    expect(s.phase).toEqual({ kind: "night", step: "guard" });
    expect(() => run(s, { type: "guard", seat: GUARD, target: 5 })).toThrow("不可連續兩晚");
    expect(() => run(s, { type: "guard", seat: GUARD, target: 6 })).not.toThrow();
  });

  it("女巫首夜可以自救", () => {
    const s = playNight(newGame(), { knife: WITCH, witch: { use: "save" } });
    expect(roleOf(s, WITCH).alive).toBe(true);
    expect(s.events.find((e) => e.type === "dawn")).toMatchObject({ deaths: [] });
  });

  it("女巫第二夜起不能自救", () => {
    let s = skipDay(playNight(newGame(), { knife: 5 }));
    s = run(s, { type: "timeout" });
    for (const wolf of WOLVES) s = run(s, { type: "wolfVote", seat: wolf, target: WITCH });
    s = run(s, { type: "timeout" });
    expect(() => run(s, { type: "witch", seat: WITCH, use: "save" })).toThrow("第二夜起不能自救");
  });

  it("一晚只能使用一瓶藥", () => {
    let s = run(newGame(), { type: "timeout" });
    for (const wolf of WOLVES) s = run(s, { type: "wolfVote", seat: wolf, target: 5 });
    s = run(s, { type: "timeout" }, { type: "witch", seat: WITCH, use: "save" });
    expect(() => run(s, { type: "witch", seat: WITCH, use: "poison", target: 1 })).toThrow("一晚只能使用一瓶藥");
  });

  it("非本階段角色不能行動", () => {
    expect(() => run(newGame(), { type: "seerCheck", seat: SEER, target: 1 })).toThrow("不是這個角色的行動時間");
    expect(() => run(newGame(), { type: "guard", seat: 5, target: 6 })).toThrow("不是守衛");
  });

  it("狼人平票時從最高票中選一個刀口", () => {
    let s = run(newGame(), { type: "timeout" });
    s = run(
      s,
      { type: "wolfVote", seat: 1, target: 5 },
      { type: "wolfVote", seat: 2, target: 5 },
      { type: "wolfVote", seat: 3, target: 6 },
      { type: "wolfVote", seat: 4, target: 6 },
      { type: "timeout" },
    );
    expect([5, 6]).toContain(s.night.knife);
  });
});

describe("白天流程", () => {
  it("平安夜沒有遺言，直接開始發言", () => {
    const s = playNight(newGame(), { guard: 5, knife: 5 });
    expect(s.events.find((e) => e.type === "dawn")).toMatchObject({ deaths: [] });
    expect(s.phase.kind).toBe("speech");
  });

  it("首夜獵人被刀：先開槍，兩人都有遺言，從獵人下一位開始發言", () => {
    let s = playNight(newGame(), { knife: HUNTER });
    expect(s.phase).toEqual({ kind: "hunter", seat: HUNTER });
    s = run(s, { type: "shoot", seat: HUNTER, target: 1 });
    expect(s.phase).toEqual({ kind: "lastWords", seat: HUNTER });
    s = run(s, { type: "endSpeech", seat: HUNTER });
    expect(s.phase).toEqual({ kind: "lastWords", seat: 1 });
    s = run(s, { type: "endSpeech", seat: 1 });
    expect(s.phase).toEqual({ kind: "speech", seat: 12, pk: false });
  });

  it("被毒死的獵人不能開槍", () => {
    let s = playNight(newGame(), { knife: 5, witch: { use: "poison", target: HUNTER } });
    expect(s.queue.some((step) => step.kind === "hunter")).toBe(false);
    expect(s.phase).toEqual({ kind: "lastWords", seat: 5 });
    s = finishSpeeches(s);
    expect(s.phase.kind).toBe("vote");
  });

  it("第二夜起的夜間死者沒有遺言", () => {
    let s = skipDay(playNight(newGame(), { guard: 5, knife: 5 }));
    s = playNight(s, { knife: 6 });
    expect(roleOf(s, 6).alive).toBe(false);
    expect(s.phase).toEqual({ kind: "speech", seat: 7, pk: false });
  });

  it("放逐後發表遺言，接著進入下一夜", () => {
    let s = finishSpeeches(playNight(newGame(), { guard: 5, knife: 5 }));
    s = everyoneVotes(s, 5);
    expect(s.phase).toEqual({ kind: "lastWords", seat: 5 });
    s = run(s, { type: "endSpeech", seat: 5 });
    expect(s.day).toBe(2);
    expect(s.phase).toEqual({ kind: "night", step: "guard" });
  });

  it("獵人被放逐，遺言後開槍", () => {
    let s = finishSpeeches(playNight(newGame(), { guard: 5, knife: 5 }));
    s = everyoneVotes(s, HUNTER);
    s = run(s, { type: "endSpeech", seat: HUNTER });
    expect(s.phase).toEqual({ kind: "hunter", seat: HUNTER });
    s = run(s, { type: "shoot", seat: HUNTER, target: 1 });
    expect(roleOf(s, 1).alive).toBe(false);
    expect(s.phase).toEqual({ kind: "night", step: "guard" });
  });

  it("平票進入 PK，再平票當天無人出局", () => {
    let s = finishSpeeches(playNight(newGame(), { guard: 5, knife: 5 }));
    for (const seat of [1, 2, 3, 4, 5, 6]) s = run(s, { type: "vote", seat, target: 7 });
    for (const seat of [7, 8, 9, 10, 11, 12]) s = run(s, { type: "vote", seat, target: 8 });
    expect(s.phase).toEqual({ kind: "speech", seat: 7, pk: true });
    s = finishSpeeches(s);
    expect(s.phase).toEqual({ kind: "vote", pk: true, candidates: [7, 8] });
    expect(() => run(s, { type: "vote", seat: 7, target: 8 })).toThrow("不能投票");
    expect(() => run(s, { type: "vote", seat: 1, target: 9 })).toThrow("只能投給 PK 台上的玩家");

    for (const seat of [1, 2, 3, 4, 5]) s = run(s, { type: "vote", seat, target: 7 });
    for (const seat of [6, 9, 10, 11, 12]) s = run(s, { type: "vote", seat, target: 8 });
    expect(s.phase).toEqual({ kind: "night", step: "guard" });
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it("PK 投票決出放逐者", () => {
    let s = finishSpeeches(playNight(newGame(), { guard: 5, knife: 5 }));
    for (const seat of [1, 2, 3, 4, 5, 6]) s = run(s, { type: "vote", seat, target: 7 });
    for (const seat of [7, 8, 9, 10, 11, 12]) s = run(s, { type: "vote", seat, target: 8 });
    s = everyoneVotes(finishSpeeches(s), 8);
    expect(s.phase).toEqual({ kind: "lastWords", seat: 8 });
  });

  it("投票逾時，沒投的人視為棄票", () => {
    let s = finishSpeeches(playNight(newGame(), { guard: 5, knife: 5 }));
    s = run(s, { type: "vote", seat: 1, target: 9 }, { type: "timeout" });
    expect(roleOf(s, 9).alive).toBe(false);
    expect(s.events.findLast((e) => e.type === "vote")).toMatchObject({ exiled: 9, votes: { 1: 9, 2: null } });
  });

  it("只有目前發言者可以發言", () => {
    const s = playNight(newGame(), { knife: 5 });
    expect(() => run(s, { type: "say", seat: 6, text: "嗨" })).toThrow("不是你的發言時間");
    const after = run(s, { type: "say", seat: 5, text: "我是平民" });
    expect(after.events.at(-1)).toMatchObject({ type: "speech", seat: 5, kind: "lastWords", to: "all" });
  });
});

describe("勝負（屠邊）", () => {
  const players = (dead: Role[]): Player[] =>
    (Object.keys(BOARD) as Role[]).flatMap((role) =>
      Array.from({ length: BOARD[role] }, (_, i) => ({ seat: 0, role, alive: !(dead.includes(role) && i < BOARD[role]) })),
    );

  it("狼人全滅，好人勝", () => expect(winnerOf(players(["werewolf"]))).toBe("good"));
  it("神職全滅，狼人勝", () => expect(winnerOf(players(["seer", "witch", "hunter", "guard"]))).toBe("wolf"));
  it("平民全滅，狼人勝", () => expect(winnerOf(players(["villager"]))).toBe("wolf"));
  it("還有神職和平民，繼續遊戲", () => expect(winnerOf(players(["seer"]))).toBeNull());

  it("神職全滅，狼人勝利", () => {
    let s = playNight(newGame(), { knife: SEER, witch: { use: "poison", target: GUARD } });
    s = everyoneVotes(finishSpeeches(s), HUNTER);
    s = run(s, { type: "endSpeech", seat: HUNTER }, { type: "timeout" });
    s = playNight(s, { knife: WITCH });
    expect(s.phase).toEqual({ kind: "ended", winner: "wolf" });
  });
});

describe("資訊可見性", () => {
  it("平民只看得到自己的身份", () => {
    const view = viewFor(newGame(), 5);
    expect(view.players.filter((p) => p.role !== null).map((p) => p.seat)).toEqual([5]);
    expect(view.omniscient).toBe(false);
  });

  it("狼人看得到隊友與狼隊頻道，平民看不到", () => {
    let s = run(newGame(), { type: "timeout" });
    s = run(s, { type: "wolfChat", seat: 1, text: "刀 9 號" });
    const wolf = viewFor(s, 2);
    expect(wolf.players.filter((p) => p.role === "werewolf").map((p) => p.seat)).toEqual(WOLVES);
    expect(wolf.events.some((e) => e.type === "wolfChat")).toBe(true);
    expect(viewFor(s, 5).events.some((e) => e.type === "wolfChat")).toBe(false);
  });

  it("預言家的查驗結果只有自己看得到", () => {
    const s = playNight(newGame(), { guard: 5, knife: 5, check: 1 });
    expect(viewFor(s, SEER).events.find((e) => e.type === "seerResult")).toMatchObject({ target: 1, team: "wolf" });
    expect(viewFor(s, 5).events.some((e) => e.type === "seerResult")).toBe(false);
  });

  it("女巫在解藥未用時才知道刀口", () => {
    let s = run(newGame(), { type: "timeout" });
    for (const wolf of WOLVES) s = run(s, { type: "wolfVote", seat: wolf, target: 5 });
    s = run(s, { type: "timeout" });
    expect(viewFor(s, WITCH).events.find((e) => e.type === "witchInfo")).toMatchObject({ target: 5 });
    expect(viewFor(s, 6).events.some((e) => e.type === "witchInfo")).toBe(false);
  });

  it("天亮公告不透露死因", () => {
    const s = playNight(newGame(), { knife: 5, witch: { use: "poison", target: 6 } });
    const view = viewFor(s, 7);
    expect(view.events.some((e) => e.type === "death")).toBe(false);
    expect(view.events.find((e) => e.type === "dawn")).toMatchObject({ deaths: [5, 6] });
  });

  it("死亡玩家取得上帝視角", () => {
    const s = playNight(newGame(), { knife: 5 });
    const view = viewFor(s, 5);
    expect(view.omniscient).toBe(true);
    expect(view.players.every((p) => p.role !== null)).toBe(true);
    expect(view.events.some((e) => e.type === "death")).toBe(true);
  });

  it("ignoreDeath 時，死者仍然只有活人的視角", () => {
    const s = playNight(newGame(), { knife: 5 });
    const view = viewFor(s, 5, { ignoreDeath: true });
    expect(view.omniscient).toBe(false);
    expect(view.players.filter((p) => p.role !== null).map((p) => p.seat)).toEqual([5]);
    expect(view.events.some((e) => e.type === "death")).toBe(false);
  });

  it("放逐的狼人身份不公開", () => {
    const s = everyoneVotes(finishSpeeches(playNight(newGame(), { guard: 5, knife: 5 })), 2);
    expect(roleOf(s, 2).alive).toBe(false);
    expect(viewFor(s, 6).players.find((p) => p.seat === 2)?.role).toBeNull();
  });
});
