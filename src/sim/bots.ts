import { viewFor, type Action, type GameState, type GameView, type Seat } from "@/engine";
import { analyze } from "./analysis";
import { mostSuspicious, readTable, type Reads } from "./reads";

// 規則式 AI：夜晚行動、投票、開槍依 reads.ts 的盤邏輯決定；發言優先交給 Groq（LocalGame 的 SpeechProvider），
// 這裡的罐頭台詞只在沒有 API key、額度用完或逾時時使用

const pickOne = <T>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

const seerResults = (v: GameView) => v.events.flatMap((e) => (e.type === "seerResult" ? [e] : []));

export function botActions(s: GameState, seat: Seat): Action[] {
  const me = s.players[seat - 1];
  // 以「活著的視角」決定：獵人死後開槍、發表遺言時不能拿到上帝視角
  const view = viewFor(s, seat, { ignoreDeath: true });
  const phase = s.phase;
  const alive = s.players.filter((p) => p.alive).map((p) => p.seat);
  const others = alive.filter((x) => x !== seat);
  const wolves = view.players.filter((p) => p.role === "werewolf").map((p) => p.seat);
  const nonWolves = others.filter((x) => !wolves.includes(x));
  const isWolf = me.role === "werewolf";

  switch (phase.kind) {
    case "night": {
      if (!me.alive) return [];
      const reads = readTable(view);
      if (phase.step === "guard" && me.role === "guard") return [{ type: "guard", seat, target: guardTarget(s, view, reads, alive) }];
      if (phase.step === "wolf" && isWolf) return [{ type: "wolfVote", seat, target: knifeTarget(s, view, reads, nonWolves) }];
      if (phase.step === "witch" && me.role === "witch") return witchActions(s, view, reads, seat, others);
      if (phase.step === "seer" && me.role === "seer") {
        const checked = seerResults(view).map((r) => r.target);
        const target = mostSuspicious(reads, others.filter((x) => !checked.includes(x)), 1.5);
        return target ? [{ type: "seerCheck", seat, target }] : [];
      }
      return [];
    }
    case "speech":
    case "lastWords":
      if (phase.seat !== seat) return [];
      return [
        { type: "say", seat, text: speechFor(s, view) },
        { type: "endSpeech", seat },
      ];
    case "vote": {
      if (!me.alive || phase.candidates?.includes(seat)) return [];
      const pool = (phase.candidates ?? others).filter((x) => x !== seat);
      return [{ type: "vote", seat, target: voteTarget(view, readTable(view), pool, isWolf ? wolves : []) ?? null }];
    }
    case "hunter": {
      if (phase.seat !== seat) return [];
      const reads = readTable(view);
      const target = mostSuspicious(reads, others, 0.5);
      // 沒有明確的嫌疑人時，一半機率不開槍，避免誤殺好人
      const confident = target !== undefined && (reads.score(target) >= 1.5 || Math.random() < 0.5);
      return [{ type: "shoot", seat, target: confident ? target : null }];
    }
    default:
      return [];
  }
}

function voteTarget(view: GameView, reads: Reads, pool: Seat[], wolves: Seat[]): Seat | undefined {
  if (!wolves.length) return mostSuspicious(reads, pool, 0.3);
  // 狼人：跟著好人的節奏投最可疑的好人（顯得自然）；對查殺隊友的預言家優先反咬
  const goods = pool.filter((x) => !wolves.includes(x));
  const threat = reads.seerClaims.find((c) => c.team === "wolf" && wolves.includes(c.target) && goods.includes(c.seat))?.seat;
  if (threat !== undefined && Math.random() < 0.7) return threat;
  // PK 只剩隊友時，投不到好人就棄票
  return goods.length ? mostSuspicious(reads, goods) : undefined;
}

function knifeTarget(s: GameState, view: GameView, reads: Reads, nonWolves: Seat[]): Seat | null {
  // 狼隊要刀同一人：今晚已經有隊友投了，就跟他
  const teammateVote = view.events.findLast((e) => e.type === "wolfVote" && e.day === s.day && e.target !== null);
  if (teammateVote?.type === "wolfVote" && teammateVote.target !== null && nonWolves.includes(teammateVote.target)) return teammateVote.target;

  const wolves = view.players.filter((p) => p.role === "werewolf").map((p) => p.seat);
  const priority = (seat: Seat) => {
    const claim = reads.claims.get(seat);
    let value = Math.random();
    if (claim === "seer") value += 10;
    if (claim === "witch") value += 6;
    if (claim === "guard") value += 5;
    if (claim === "hunter") value -= 5; // 刀獵人會被開槍帶走
    // 盯上狼隊的人（踩過隊友）先處理
    value += (reads.accusations.get(seat) ?? []).filter((x) => wolves.includes(x)).length;
    return value;
  };
  let best: Seat | null = null;
  let bestValue = -Infinity;
  for (const seat of nonWolves) {
    const value = priority(seat);
    if (value > bestValue) [best, bestValue] = [seat, value];
  }
  return best;
}

function guardTarget(s: GameState, view: GameView, reads: Reads, alive: Seat[]): Seat | null {
  const allowed = alive.filter((x) => x !== view.lastGuard);
  // 首夜常見空守，避免和女巫的解藥撞在同一人身上（同守同救會死）
  if (s.day === 1 && Math.random() < 0.5) return null;
  if (reads.trustedSeer !== null && allowed.includes(reads.trustedSeer)) return reads.trustedSeer;
  // 其次守公開跳的神職，再來是看起來最像好人的人
  const claimed = allowed.find((x) => reads.claims.get(x) === "witch");
  if (claimed !== undefined && Math.random() < 0.6) return claimed;
  const trusted = [...allowed].sort((a, b) => reads.score(a) - reads.score(b)).slice(0, 4);
  return pickOne(trusted) ?? null;
}

function witchActions(s: GameState, view: GameView, reads: Reads, seat: Seat, others: Seat[]): Action[] {
  const info = view.events.findLast((e) => e.type === "witchInfo" && e.day === s.day);
  const knife = info?.type === "witchInfo" ? info.target : null;
  // 首夜一定救（包含自救）；之後救看起來像好人的人
  if (knife !== null && view.potions?.antidote && (s.day === 1 || (knife !== seat && reads.score(knife) < 2))) {
    return [{ type: "witch", seat, use: "save" }];
  }
  if (view.potions?.poison && s.day >= 2) {
    const target = mostSuspicious(reads, others, 0.3);
    const score = target === undefined ? 0 : reads.score(target);
    // 只在有把握時用毒：被信任的預言家查殺、冒充神職、被多人踩
    const chance = score >= 4 ? 0.8 : score >= 2.5 ? 0.35 : 0;
    if (target !== undefined && Math.random() < chance) return [{ type: "witch", seat, use: "poison", target }];
  }
  return [];
}

// 罐頭台詞（沒有 LLM 時）：依盤面判斷組句子，至少講出具體的人和理由，而且每個人講的不一樣
function speechFor(s: GameState, view: GameView): string {
  const phase = s.phase;
  const a = analyze(view);
  const main = a.suspects[0];
  // 理由原本是寫給 LLM 的第二人稱，罐頭台詞改成第一人稱並拿掉括號補充
  const reason = main?.reasons
    .find((r) => !(r.startsWith("踩過") && a.accusedBy.includes(main.seat)))
    ?.replace(/（.*?）/g, "")
    .replaceAll("你", "我");
  const trust = a.trusted[0]?.seat;
  const t = a.tactic;

  if (phase.kind === "lastWords") {
    if (view.you!.role === "seer" && t?.kind === "reportChecks") return `我是預言家，${checkText(t.checks)}。好人照這個走，別被帶偏。`;
    return main ? `我走了，留一句：${main.seat} 號${reason ? `${reason}，` : ""}大家下一輪重點看他。` : "我走了，好人加油，把票集中別分散。";
  }
  if (phase.kind === "speech" && phase.pk) {
    return `我不是狼。${a.accusedBy.length ? `${a.accusedBy.map((x) => `${x} 號`).join("、")}一直踩我，` : ""}${main ? `我覺得 ${main.seat} 號更可疑，` : ""}請大家把票投給對的人。`;
  }

  if (t?.kind === "fakeSeer") return `我才是預言家！昨晚查驗 ${t.wolfCheck} 號，他是狼人，他是悍跳。${t.goldCheck ? `${t.goldCheck} 號是我的金水。` : ""}今天出 ${t.wolfCheck} 號。`;
  if (t?.kind === "reportChecks" && (t.checks.some((c) => c.wolf) || s.day >= 2)) return `我是預言家，${checkText(t.checks)}。${t.checks.some((c) => c.wolf) ? "今天大家跟我投查殺。" : "金水可以先放一邊，看其他人。"}`;
  if (t?.kind === "backClaim") return `我站 ${t.seat} 號的預言家，他的發言比較像真的。${main ? `${main.seat} 號我覺得有問題，這輪投他。` : ""}`;

  const parts: string[] = [];
  if (a.accusedBy.length) parts.push(pickOne([`${a.accusedBy[0]} 號踩我沒有道理，我是好人`, `${a.accusedBy[0]} 號，你點我點得太急了`])!);
  if (main) {
    parts.push(
      pickOne([
        `我比較懷疑 ${main.seat} 號${reason ? `，因為他${reason}` : "，發言一直在繞"}`,
        `${main.seat} 號我看不下去${reason ? `，${reason}` : "，立場搖擺"}`,
        `這輪我想出 ${main.seat} 號${reason ? `，他${reason}` : ""}`,
      ])!,
    );
  } else {
    parts.push(pickOne(["目前每個人都講得差不多，我先看票型", "還沒有明顯的狼，我等等看誰在跟風", "前面發言都太保守了，我不太滿意"])!);
  }
  if (trust !== undefined) parts.push(pickOne([`${trust} 號我暫時相信`, `${trust} 號偏好人，先不動他`])!);
  if (main) parts.push(`投票我會投 ${main.seat} 號`);
  return `${parts.join("，")}。`;
}

const checkText = (checks: { target: Seat; wolf: boolean }[]) =>
  checks.map((c) => `${c.target} 號是${c.wolf ? "狼人" : "好人"}`).join("、");
