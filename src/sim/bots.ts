import { viewFor, type Action, type GameState, type GameView, type Seat } from "@/engine";

// 規則式 AI：夜晚行動、投票、開槍用隨機合法行動；發言優先交給 Groq（LocalGame 的 SpeechProvider），
// 這裡的罐頭台詞只在沒有 API key、額度用完或逾時時使用

const pickOne = <T>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

const seerResults = (v: GameView) => v.events.flatMap((e) => (e.type === "seerResult" ? [e] : []));

export function botActions(s: GameState, seat: Seat): Action[] {
  const me = s.players[seat - 1];
  const view = viewFor(s, seat);
  const phase = s.phase;
  const alive = s.players.filter((p) => p.alive).map((p) => p.seat);
  const others = alive.filter((x) => x !== seat);
  const wolves = view.players.filter((p) => p.role === "werewolf").map((p) => p.seat);
  const nonWolves = others.filter((x) => !wolves.includes(x));

  switch (phase.kind) {
    case "night": {
      if (!me.alive) return [];
      if (phase.step === "guard" && me.role === "guard") {
        return [{ type: "guard", seat, target: pickOne(alive.filter((x) => x !== view.lastGuard)) ?? null }];
      }
      if (phase.step === "wolf" && me.role === "werewolf") return [{ type: "wolfVote", seat, target: pickOne(nonWolves) ?? null }];
      if (phase.step === "witch" && me.role === "witch") return witchActions(s, view, seat, others);
      if (phase.step === "seer" && me.role === "seer") {
        const checked = seerResults(view).map((r) => r.target);
        const target = pickOne(others.filter((x) => !checked.includes(x)));
        return target ? [{ type: "seerCheck", seat, target }] : [];
      }
      return [];
    }
    case "speech":
    case "lastWords":
      if (phase.seat !== seat) return [];
      return [
        { type: "say", seat, text: speechFor(s, view, seat, me.role === "werewolf" ? nonWolves : others) },
        { type: "endSpeech", seat },
      ];
    case "vote": {
      if (!me.alive || phase.candidates?.includes(seat)) return [];
      const pool = (phase.candidates ?? others).filter((x) => x !== seat);
      const knownWolf = seerResults(view).find((r) => r.team === "wolf" && pool.includes(r.target))?.target;
      const target = me.role === "werewolf" ? pickOne(pool.filter((x) => !wolves.includes(x))) : (knownWolf ?? pickOne(pool));
      return [{ type: "vote", seat, target: target ?? null }];
    }
    case "hunter":
      if (phase.seat !== seat) return [];
      return [{ type: "shoot", seat, target: Math.random() < 0.6 ? (pickOne(others) ?? null) : null }];
    default:
      return [];
  }
}

function witchActions(s: GameState, view: GameView, seat: Seat, others: Seat[]): Action[] {
  const info = view.events.findLast((e) => e.type === "witchInfo" && e.day === s.day);
  const knife = info?.type === "witchInfo" ? info.target : null;
  if (knife !== null && view.potions?.antidote && (knife !== seat || s.day === 1)) return [{ type: "witch", seat, use: "save" }];
  if (view.potions?.poison && s.day >= 2 && Math.random() < 0.2) {
    const target = pickOne(others);
    if (target) return [{ type: "witch", seat, use: "poison", target }];
  }
  return [];
}

function speechFor(s: GameState, view: GameView, seat: Seat, suspects: Seat[]): string {
  const phase = s.phase;
  const me = s.players[seat - 1];
  const suspect = pickOne(suspects) ?? suspects[0];

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
