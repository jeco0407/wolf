import { describe, expect, it } from "vitest";
import { newGame, playNight, run } from "@/engine/__tests__/helpers";
import { buildMessages, buildSpeechRequest, cleanSpeech, validateSpeechRequest } from "../speech";

const NAMES = Array.from({ length: 12 }, (_, i) => `玩家${i + 1}`);

describe("AI 發言請求", () => {
  it("狼人拿得到隊友與狼隊私聊，平民拿不到", () => {
    const s = run(newGame(), { type: "timeout" }, { type: "wolfChat", seat: 1, text: "今晚刀 9 號" }, { type: "timeout" }, { type: "timeout" }, { type: "timeout" });
    const wolf = buildSpeechRequest(s, 2, NAMES, "冷靜");
    expect(wolf.knowledge.join("\n")).toContain("狼隊友：1 號、3 號、4 號");
    expect(wolf.knowledge.join("\n")).toContain("今晚刀 9 號");
    expect(buildSpeechRequest(s, 5, NAMES, "冷靜").knowledge).toEqual([]);
  });

  it("預言家拿得到自己的查驗結果", () => {
    const s = playNight(newGame(), { guard: 5, knife: 5, check: 1 });
    expect(buildSpeechRequest(s, 9, NAMES, "冷靜").knowledge).toContain("你第 1 夜查驗 1 號：狼人");
  });

  it("發表遺言時不會拿到上帝視角", () => {
    const s = playNight(newGame(), { knife: 5 });
    const req = buildSpeechRequest(s, 5, NAMES, "冷靜");
    expect(req.kind).toBe("lastWords");
    expect(req.knowledge).toEqual([]);
    expect(req.roster).toContain("5 號 玩家5（出局）");
  });

  it("提到自己的座位時標上（你），避免模型把自己當成別人", () => {
    const s = playNight(newGame(), { knife: 10 });
    const req = buildSpeechRequest(s, 10, NAMES, "耿直");
    expect(req.kind).toBe("lastWords");
    expect(req.role).toBe("witch");
    expect(req.knowledge).toContain("第 1 夜被刀的是 10 號（你）");
    expect(req.publicLog).toContain("第 1 天天亮：昨晚死亡 10 號（你）");
    expect(buildMessages(req)[0].content).toContain("提到自己時用「我」");
  });

  it("發言紀錄只保留最近 16 句，且每句有長度上限", () => {
    let s = playNight(newGame(), { guard: 5, knife: 5 });
    for (let i = 0; i < 12 && s.phase.kind === "speech"; i++) {
      const seat = s.phase.seat;
      s = run(s, { type: "say", seat, text: "很長的發言".repeat(40) }, { type: "say", seat, text: "補充" }, { type: "endSpeech", seat });
    }
    const req = buildSpeechRequest(s, 5, NAMES, "冷靜");
    expect(req.transcript).toHaveLength(16);
    expect(req.transcript.every((line) => line.length <= 200)).toBe(true);
  });
});

describe("伺服器端驗證", () => {
  const valid = () => buildSpeechRequest(playNight(newGame(), { guard: 5, knife: 5 }), 5, NAMES, "冷靜");

  it("接受正確的請求並丟掉多餘欄位", () => {
    const req = valid();
    expect(validateSpeechRequest({ ...req, extra: "x" })).toEqual(req);
  });

  it("拒絕格式錯誤或過大的請求", () => {
    const req = valid();
    expect(validateSpeechRequest(null)).toBeNull();
    expect(validateSpeechRequest({ ...req, seat: 99 })).toBeNull();
    expect(validateSpeechRequest({ ...req, role: "god" })).toBeNull();
    expect(validateSpeechRequest({ ...req, role: "constructor" })).toBeNull();
    expect(validateSpeechRequest({ ...req, kind: "chat" })).toBeNull();
    expect(validateSpeechRequest({ ...req, transcript: Array(100).fill("x") })).toBeNull();
    expect(validateSpeechRequest({ ...req, knowledge: ["x".repeat(500)] })).toBeNull();
  });
});

describe("prompt 與輸出清理", () => {
  it("prompt 包含人設、身份與任務", () => {
    const req = buildSpeechRequest(playNight(newGame(), { guard: 5, knife: 5 }), 2, NAMES, "衝動直率");
    const [system, user] = buildMessages(req);
    expect(system.content).toContain("2 號「玩家2」");
    expect(system.content).toContain("衝動直率");
    expect(system.content).toContain("真實身份是狼人");
    expect(user.content).toContain("狼隊友");
    expect(user.content).toContain("平安夜");
  });

  it("清掉引號與座位前綴", () => {
    expect(cleanSpeech("「5 號 小明：我是好人」")).toBe("我是好人");
    expect(cleanSpeech("  我覺得 3 號很可疑  ")).toBe("我覺得 3 號很可疑");
    expect(cleanSpeech("   ")).toBeNull();
    expect(cleanSpeech("好".repeat(300))?.length).toBe(201);
  });
});
