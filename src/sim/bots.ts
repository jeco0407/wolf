import { viewFor, type Action, type GameState, type GameView, type Seat } from "@/engine";
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
        { type: "say", seat, text: speechFor(s, view, readTable(view), seat, isWolf ? nonWolves : others) },
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

function speechFor(s: GameState, view: GameView, reads: Reads, seat: Seat, suspects: Seat[]): string {
  const phase = s.phase;
  const me = s.players[seat - 1];
  const suspect = mostSuspicious(reads, suspects) ?? suspects[0];

  if (phase.kind === "lastWords") {
    return pickOne([`我是好人，走得有點冤。大家注意 ${suspect} 號。`, `我沒什麼資訊，希望好人加油，${suspect} 號可以多聽聽。`])!;
  }
  if (phase.kind === "speech" && phase.pk) return `我真的是好人，請大家不要投我。${suspect} 號比我可疑多了。`;

  if (me.role === "seer") {
    const last = seerResults(view).at(-1);
    if (last && (last.team === "wolf" || Math.random() < 0.4)) {
      return `我是預言家，昨晚查驗 ${last.target} 號，他是${last.team === "wolf" ? "狼人，大家跟我投他" : "好人"}。`;
    }
  }

  return pickOne([
    "我是好人，這輪沒什麼資訊，先聽聽後面怎麼說。",
    `我覺得 ${suspect} 號剛才的發言有點刻意，這輪先關注他。`,
    s.dawnDeaths.length
      ? `昨晚死了 ${s.dawnDeaths.join("、")} 號，我覺得狼人在隱藏，大家別被帶節奏。`
      : "平安夜的話，守衛或女巫應該有動作，我先相信前面的發言。",
    `我是平民，跟著預言家走。${suspect} 號我先打個問號。`,
  ])!;
}
