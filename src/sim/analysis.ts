import type { GameView, Seat } from "@/engine";
import { readTable, type Reads } from "./reads";

// 把 reads.ts 的分數整理成「盤面判斷」：懷疑誰、為什麼、打算投誰，狼人另外有戰術。
// LLM 發言拿它當思考的依據（讓發言和之後的投票一致），額度用完時罐頭台詞也用它組句子。

export interface Suspect {
  seat: Seat;
  reasons: string[];
}

export type Tactic =
  | { kind: "fakeSeer"; wolfCheck: Seat; goldCheck: Seat | null } // 狼人悍跳預言家
  | { kind: "backClaim"; seat: Seat } // 狼人：支持悍跳的隊友
  | { kind: "reportChecks"; checks: { target: Seat; wolf: boolean }[] } // 真預言家報查驗
  | null;

export interface Analysis {
  isWolf: boolean;
  suspects: Suspect[];
  trusted: Suspect[];
  voteIntent: Seat | null;
  // 誰踩過我
  accusedBy: Seat[];
  // 狼人：隊友、被查殺的隊友
  teammates: Seat[];
  exposed: Seat[];
  tactic: Tactic;
  reads: Reads;
}

const top = (reads: Reads, pool: Seat[], dir: 1 | -1, min: number, count: number): Suspect[] =>
  [...pool]
    .filter((s) => reads.score(s) * dir >= min)
    .sort((a, b) => (reads.score(b) - reads.score(a)) * dir)
    .slice(0, count)
    .map((seat) => ({ seat, reasons: reads.reasons(seat).slice(0, 2) }));

export function analyze(view: GameView): Analysis {
  const me = view.you!;
  const reads = readTable(view);
  const alive = view.players.filter((p) => p.alive).map((p) => p.seat);
  const others = alive.filter((s) => s !== me.seat);
  const isWolf = me.role === "werewolf";
  const wolves = isWolf ? view.players.filter((p) => p.role === "werewolf").map((p) => p.seat) : [];
  const teammates = wolves.filter((s) => s !== me.seat && alive.includes(s));
  const pool = isWolf ? others.filter((s) => !wolves.includes(s)) : others;

  const suspects = top(reads, pool, 1, 0.8, 2);
  const trusted = top(reads, pool, -1, 1, 2);
  const voteIntent = suspects[0]?.seat ?? null;
  const accusedBy = [...reads.accusations].filter(([, targets]) => targets.includes(me.seat)).map(([seat]) => seat);

  let tactic: Tactic = null;
  const exposed = isWolf ? [...new Set(reads.seerClaims.filter((c) => c.team === "wolf" && wolves.includes(c.target)).map((c) => c.target))] : [];
  if (isWolf) {
    const wolfClaimant = wolves.find((s) => reads.claims.get(s) === "seer" && alive.includes(s));
    // 只對還活著的預言家悍跳；金水只發給還活著、被查殺的隊友
    const realSeer = reads.seerClaims.find((c) => !wolves.includes(c.seat) && alive.includes(c.seat))?.seat;
    // 預言家跳出來查殺了隊友、還沒有狼對跳時，由「沒被查殺、座號最小的存活狼」負責悍跳，避免多狼一起跳
    const jumper = wolves.filter((s) => alive.includes(s) && !exposed.includes(s)).sort((a, b) => a - b)[0];
    if (wolfClaimant !== undefined && wolfClaimant !== me.seat) tactic = { kind: "backClaim", seat: wolfClaimant };
    else if (wolfClaimant === undefined && realSeer !== undefined && exposed.length && jumper === me.seat && view.day <= 3) {
      tactic = { kind: "fakeSeer", wolfCheck: realSeer, goldCheck: exposed.find((s) => alive.includes(s)) ?? null };
    }
  } else if (me.role === "seer") {
    const checks = view.events.flatMap((e) => (e.type === "seerResult" ? [{ target: e.target, wolf: e.team === "wolf" }] : []));
    if (checks.length) tactic = { kind: "reportChecks", checks };
  }

  return { isWolf, suspects, trusted, voteIntent, accusedBy, teammates, exposed, tactic, reads };
}

// 給 LLM 的判斷摘要（每行一句）
export function analysisLines(a: Analysis, mySeat: Seat): string[] {
  const lines: string[] = [];
  const why = (s: Suspect) => (s.reasons.length ? `（${s.reasons.join("；")}）` : "");
  if (a.teammates.length) lines.push(`存活的狼隊友：${a.teammates.map((s) => `${s} 號`).join("、")}，不要踩他們，也不要表現得太護著他們`);
  for (const s of a.exposed) if (s !== mySeat) lines.push(`隊友 ${s} 號被查殺了，想辦法幫他洗白，或在必要時切割`);
  if (a.exposed.includes(mySeat)) lines.push("你被預言家查殺了，要反駁、質疑他是悍跳的狼");
  if (a.reads.trustedSeer !== null && a.reads.trustedSeer !== mySeat) lines.push(`你目前相信 ${a.reads.trustedSeer} 號是真預言家`);
  if (a.isWolf) {
    // 狼人的分數是「好人眼中誰可疑」：跟著踩最自然
    a.suspects.forEach((s) => lines.push(`好人容易懷疑 ${s.seat} 號${why(s)}，可以跟著踩`));
    for (const s of a.trusted) lines.push(`好人比較信任 ${s.seat} 號${why(s)}，可以想辦法讓大家懷疑他`);
  } else {
    a.suspects.forEach((s, i) => lines.push(`${i === 0 ? "你最懷疑" : "其次懷疑"} ${s.seat} 號${why(s)}`));
    for (const s of a.trusted) lines.push(`你覺得 ${s.seat} 號偏好人${why(s)}`);
  }
  if (a.accusedBy.length) lines.push(`${a.accusedBy.map((s) => `${s} 號`).join("、")}踩過你，要回應`);
  if (a.voteIntent !== null) lines.push(`你這輪打算投 ${a.voteIntent} 號`);

  const t = a.tactic;
  if (t?.kind === "fakeSeer") {
    lines.push(
      `戰術：你要悍跳預言家，說你昨晚查驗 ${t.wolfCheck} 號是狼人（查殺），他才是假預言家${t.goldCheck ? `；再給 ${t.goldCheck} 號發金水` : ""}，語氣要篤定`,
    );
  } else if (t?.kind === "backClaim") {
    lines.push(`戰術：隊友 ${t.seat} 號已經悍跳預言家，你要站邊支持他，但不要表現得太刻意`);
  } else if (t?.kind === "reportChecks") {
    lines.push(`你的查驗結果：${t.checks.map((c) => `${c.target} 號是${c.wolf ? "狼人（查殺）" : "好人（金水）"}`).join("、")}。適合的時機可以跳出來報`);
  }
  return lines;
}

export const analyzeView = (view: GameView) => analysisLines(analyze(view), view.you!.seat);
