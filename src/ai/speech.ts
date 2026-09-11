import { ROLE_NAME, SEAT_COUNT, viewFor, type GameState, type Role, type Seat, type SpeechKind } from "@/engine";

// AI 發言的請求：前端（之後是 Convex）依該 AI 的視角整理成精簡摘要，伺服器再組成 prompt。
// Groq 免費方案有每分鐘與每日額度，所以摘要要短：只留最近的發言與公告。
export interface SpeechRequest {
  seat: Seat;
  name: string;
  style: string;
  role: Role;
  day: number;
  kind: SpeechKind;
  roster: string;
  knowledge: string[];
  publicLog: string[];
  transcript: string[];
}

export const LIMITS = { knowledge: 12, publicLog: 10, transcript: 16, text: 120, line: 200, roster: 400, name: 12, style: 60 };

const clip = (text: string, max = LIMITS.text) => (text.length > max ? `${text.slice(0, max)}…` : text);

function voteLine(votes: Record<Seat, Seat | null>): string {
  const byTarget = new Map<Seat, Seat[]>();
  const abstain: Seat[] = [];
  for (const [voter, target] of Object.entries(votes)) {
    if (target === null) abstain.push(Number(voter));
    else byTarget.set(target, [...(byTarget.get(target) ?? []), Number(voter)]);
  }
  const parts = [...byTarget].map(([target, voters]) => `${target} 號←${voters.join("、")}`);
  if (abstain.length) parts.push(`棄票 ${abstain.join("、")}`);
  return parts.join("；") || "無人投票";
}

export function buildSpeechRequest(s: GameState, seat: Seat, names: string[], style: string): SpeechRequest {
  // 以「活著的視角」整理：發表遺言時雖已出局，也不能拿到上帝視角的資訊
  const view = viewFor(s, seat, { ignoreDeath: true });
  const me = view.you!;
  // 提到自己的座位時標上「（你）」，否則模型常把自己當成別人（例如遺言時用第三人稱談自己）
  const seatLabel = (x: Seat | null) => (x === null ? "沒有人" : x === seat ? `${x} 號（你）` : `${x} 號`);
  const phase = s.phase;
  const kind: SpeechKind = phase.kind === "lastWords" ? "lastWords" : phase.kind === "speech" && phase.pk ? "pk" : "speech";

  const knowledge: string[] = [];
  const publicLog: string[] = [];
  const transcript: string[] = [];

  for (const e of view.events) {
    switch (e.type) {
      case "wolfTeam":
        knowledge.push(`狼隊友：${e.seats.filter((x) => x !== seat).map(seatLabel).join("、")}`);
        break;
      case "wolfChat":
        knowledge.push(`（第 ${e.day} 夜狼隊私聊）${seatLabel(e.seat)}：${clip(e.text, 60)}`);
        break;
      case "knife":
        knowledge.push(`第 ${e.day} 夜狼隊刀了 ${seatLabel(e.target)}`);
        break;
      case "witchInfo":
        knowledge.push(`第 ${e.day} 夜被刀的是 ${seatLabel(e.target)}`);
        break;
      case "witch":
        knowledge.push(`你第 ${e.day} 夜${e.use === "save" ? "用解藥救了" : "用毒藥毒了"} ${seatLabel(e.target)}`);
        break;
      case "guard":
        knowledge.push(`你第 ${e.day} 夜守護了 ${seatLabel(e.target)}`);
        break;
      case "seerResult":
        knowledge.push(`你第 ${e.day} 夜查驗 ${seatLabel(e.target)}：${e.team === "wolf" ? "狼人" : "好人"}`);
        break;
      case "dawn":
        publicLog.push(`第 ${e.day} 天天亮：${e.deaths.length ? `昨晚死亡 ${e.deaths.map(seatLabel).join("、")}` : "平安夜"}`);
        break;
      case "vote": {
        const result = e.exiled !== null ? `${seatLabel(e.exiled)} 被放逐` : e.tie.length > 1 && !e.pk ? `${e.tie.map(seatLabel).join("、")} 平票進 PK` : "無人出局";
        publicLog.push(`第 ${e.day} 天${e.pk ? " PK " : ""}投票：${result}（${voteLine(e.votes)}）`);
        break;
      }
      case "shot":
        publicLog.push(e.target === null ? `${seatLabel(e.seat)} 是獵人，沒有開槍` : `${seatLabel(e.seat)} 是獵人，開槍帶走 ${seatLabel(e.target)}`);
        break;
      case "speech":
        transcript.push(`第 ${e.day} 天 ${seatLabel(e.seat)}${e.kind === "lastWords" ? "（遺言）" : e.kind === "pk" ? "（PK）" : ""}：${clip(e.text)}`);
        break;
    }
  }

  return {
    seat,
    name: names[seat - 1],
    style,
    role: me.role,
    day: s.day,
    kind,
    roster: view.players.map((p) => `${p.seat} 號 ${names[p.seat - 1]}${p.alive ? "" : "（出局）"}`).join("、"),
    knowledge: knowledge.slice(-LIMITS.knowledge),
    publicLog: publicLog.slice(-LIMITS.publicLog),
    transcript: transcript.slice(-LIMITS.transcript),
  };
}

const KINDS: readonly SpeechKind[] = ["speech", "pk", "lastWords"];
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isLines = (v: unknown, count: number): v is string[] =>
  Array.isArray(v) && v.length <= count && v.every((line) => isText(line, LIMITS.line));
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

// 伺服器端驗證：只接受格式正確、大小受限的欄位，多餘的欄位一律丟掉
export function validateSpeechRequest(body: unknown): SpeechRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    !isInt(b.seat, 1, SEAT_COUNT) ||
    !isInt(b.day, 1, 30) ||
    !isText(b.name, LIMITS.name) ||
    !isText(b.style, LIMITS.style) ||
    typeof b.role !== "string" ||
    !Object.hasOwn(ROLE_NAME, b.role) ||
    !KINDS.includes(b.kind as SpeechKind) ||
    !isText(b.roster, LIMITS.roster) ||
    !isLines(b.knowledge, LIMITS.knowledge) ||
    !isLines(b.publicLog, LIMITS.publicLog) ||
    !isLines(b.transcript, LIMITS.transcript)
  ) {
    return null;
  }
  return {
    seat: b.seat,
    name: b.name,
    style: b.style,
    role: b.role as Role,
    day: b.day,
    kind: b.kind as SpeechKind,
    roster: b.roster,
    knowledge: b.knowledge,
    publicLog: b.publicLog,
    transcript: b.transcript,
  };
}

const ROLE_GUIDE: Record<Role, string> = {
  werewolf: "你是狼人：隱藏身份、假裝好人，必要時可以冒充預言家等神職；把懷疑引向好人，保護狼隊友但不要太明顯。",
  villager: "你是平民：沒有技能，根據發言與投票推理誰是狼人，可以表明自己是平民。",
  seer: "你是預言家：可以跳出來報查驗結果帶領好人，也可以先隱藏；報查驗時要說清楚查了誰、結果是什麼。",
  witch: "你是女巫：通常先隱藏身份，可以暗示昨晚的資訊，必要時再表明身份。",
  hunter: "你是獵人：通常隱藏身份，被懷疑時可以亮出獵人身份自保。",
  guard: "你是守衛：通常隱藏身份，避免被狼人針對。",
};

const TASK: Record<SpeechKind, string> = {
  speech: "現在輪到你白天發言。",
  pk: "你在 PK 台上，要說服大家不要投你。",
  lastWords: "你已經出局，這是你的遺言。好人可以公開自己的真實身份與夜晚得到的資訊，幫助好人陣營；狼人則繼續偽裝，把懷疑引向好人。",
};

export function buildMessages(req: SpeechRequest): { role: "system" | "user"; content: string }[] {
  const system = [
    "你正在參加 12 人狼人殺（4 狼人、4 平民、預言家、女巫、獵人、守衛；屠邊規則；沒有警長）。",
    `你扮演 ${req.seat} 號「${req.name}」，說話風格：${req.style}。你就是 ${req.seat} 號，提到自己時用「我」，不要用第三人稱談論 ${req.seat} 號。`,
    `你的真實身份是${ROLE_NAME[req.role]}。${ROLE_GUIDE[req.role]}`,
    "輸出規則：用台灣繁體中文口語（每個字都必須是繁體字，不可以出現簡體字），40 到 120 字，只輸出發言內容本身；不要加引號、旁白、動作描述或「X 號：」前綴；用座位號稱呼其他玩家；使用常見的狼人殺術語（例如查殺、金水、站邊、踩、歸票、悍跳），不要自創詞彙，也不要夾雜英文；「屠邊」是狼人的勝利條件，不要拿來形容一晚的結果；不要編造你不可能知道的資訊，也不要評論還沒發言的人說了什麼。",
  ].join("\n");

  const list = (title: string, lines: string[]) => (lines.length ? `${title}：\n${lines.map((l) => `- ${l}`).join("\n")}` : "");
  const user = [
    `現在是第 ${req.day} 天。${TASK[req.kind]}`,
    `座位：${req.roster}`,
    list("只有你知道的資訊", req.knowledge) || "你沒有額外的私密資訊。",
    list("法官公告", req.publicLog),
    list("最近的發言", req.transcript) || "目前還沒有人發言。",
    "請直接說出你的發言：",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// 清掉模型常多加的引號與「5 號 小明：」前綴，並限制長度
export function cleanSpeech(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^["「『“]+|["」』”]+$/g, "")
    .replace(/^\s*\d+\s*號[^：:\n]{0,8}[：:]\s*/, "")
    .trim();
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
