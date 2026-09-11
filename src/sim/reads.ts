import { SEAT_COUNT, type GameView, type Role, type Seat, type Team } from "@/engine";

// 規則式 AI 的「盤邏輯」：只根據自己的視角（公開發言、票型、私密資訊）估計每個人有多可疑。
// 發言是自由文字（LLM 或真人），這裡用關鍵字粗略判斷踩人、保人、跳身份與報查驗，不求精確，只求比亂投像樣。

export interface SeerClaim {
  seat: Seat;
  target: Seat;
  team: Team;
}

export interface Reads {
  // 越高越像狼（狼人自己算的是「好人眼中誰最可疑」，用來跟風投票）
  score: (seat: Seat) => number;
  // 跳過身份的人（最後一次宣稱的身份）
  claims: Map<Seat, Role>;
  seerClaims: SeerClaim[];
  // 我相信的預言家（真預言家、對跳時選一邊）；沒有人跳或我就是預言家時為 null
  trustedSeer: Seat | null;
  // 發言中踩過誰：accuser → 被踩的座位
  accusations: Map<Seat, Seat[]>;
}

const ROLE_WORD: Record<string, Role> = { 預言家: "seer", 女巫: "witch", 獵人: "hunter", 守衛: "guard", 平民: "villager" };
const CLAIM = /我(?:才|就|真的)?是(?:真的?)?(預言家|女巫|獵人|守衛|平民)|我跳(預言家|女巫|獵人|守衛)/;
const NEGATIVE = /狼|查殺|可疑|踩|投|出局|懷疑|問號|有問題|悍跳|假|刻意|不對|划水|歸票|針對|帶節奏/;
const POSITIVE = /不是狼|不像狼|金水|好人|相信|站邊|保|清白|沒問題|認/;
const CHECK_SENTENCE = /查|驗|金水/;
const WOLF_RESULT = /查殺|是狼|狼人|頭狼/;
const GOOD_RESULT = /金水|好人/;

const seatsIn = (text: string, exclude: Seat): Seat[] =>
  [...text.matchAll(/(\d{1,2})\s*號/g)].map((m) => Number(m[1])).filter((x) => x >= 1 && x <= SEAT_COUNT && x !== exclude);

export function readTable(view: GameView): Reads {
  const me = view.you!;
  const scores = new Map<Seat, number>();
  const add = (seat: Seat, delta: number) => scores.set(seat, (scores.get(seat) ?? 0) + delta);
  const claims = new Map<Seat, Role>();
  const seerClaims: SeerClaim[] = [];
  const accusations = new Map<Seat, Seat[]>();
  // 發言的踩／保先記下來，等算完其他線索再依發言者的可信度加權
  const claimDays: { seat: Seat; target: Seat; day: number }[] = [];
  const tones: { speaker: Seat; target: Seat; tone: number }[] = [];
  const knifed = new Set<Seat>();
  const votes: { day: number; votes: Record<Seat, Seat | null> }[] = [];
  // 查殺被公開（或自己查到）的日子：之後的投票才能拿來檢驗
  const wolfCheckDay = new Map<Seat, number>();

  for (const e of view.events) {
    if (e.type === "dawn") for (const seat of e.deaths) knifed.add(seat);
    if (e.type === "vote") votes.push({ day: e.day, votes: e.votes });
    if (e.type !== "speech") continue;

    const speaker = e.seat;
    const claim = e.text.match(CLAIM);
    if (claim) claims.set(speaker, ROLE_WORD[claim[1] ?? claim[2]]);

    for (const sentence of e.text.split(/[。！？!?\n]/)) {
      if (claims.get(speaker) === "seer" && CHECK_SENTENCE.test(sentence)) {
        const target = seatsIn(sentence, speaker)[0];
        const wolf = WOLF_RESULT.test(sentence) && !/不是狼/.test(sentence);
        if (target && (wolf || GOOD_RESULT.test(sentence))) {
          seerClaims.push({ seat: speaker, target, team: wolf ? "wolf" : "good" });
          if (wolf) claimDays.push({ seat: speaker, target, day: e.day });
          continue;
        }
      }
      for (const clause of sentence.split(/[，,；;、]/)) {
        const targets = seatsIn(clause, speaker);
        if (!targets.length) continue;
        const tone = POSITIVE.test(clause) ? -0.5 : NEGATIVE.test(clause) ? 1 : 0;
        for (const target of targets) {
          if (tone) tones.push({ speaker, target, tone });
          if (tone > 0) accusations.set(speaker, [...(accusations.get(speaker) ?? []), target]);
        }
      }
    }
  }

  // 最近一次投票：被投的人也算嫌疑
  const lastVotes = votes.at(-1)?.votes;
  if (lastVotes) for (const target of Object.values(lastVotes)) if (target !== null) add(target, 0.3);

  // 預言家的可信度：真預言家知道其他跳預言家的都是狼；好人在對跳時，偏向夜裡被刀的那位，否則選先跳的
  const seerSeats = [...new Set(seerClaims.map((c) => c.seat))];
  let trustedSeer: Seat | null = null;
  if (me.role === "seer") {
    for (const seat of seerSeats) if (seat !== me.seat) add(seat, 8);
  } else if (me.role !== "werewolf" && seerSeats.length) {
    const knifedClaimant = seerSeats.find((x) => knifed.has(x));
    trustedSeer = knifedClaimant ?? (seerSeats.length === 1 || Math.random() < 0.65 ? seerSeats[0] : seerSeats[1]);
    for (const seat of seerSeats) if (seat !== trustedSeer) add(seat, 3);
    for (const c of seerClaims) {
      if (c.seat !== trustedSeer) continue;
      if (c.target === me.seat) continue;
      add(c.target, c.team === "wolf" ? 5 : -3);
    }
  }

  // 自己知道的事實
  if (me.role !== "werewolf") {
    // 我是好人：踩我的人在帶錯節奏；給我查殺的「預言家」一定是假的
    for (const [accuser, targets] of accusations) if (targets.includes(me.seat)) add(accuser, 1.5);
    for (const c of seerClaims) if (c.target === me.seat && c.team === "wolf") add(c.seat, 8);
    // 有人冒充我的神職身份 → 狼
    if (me.role !== "villager") for (const [seat, role] of claims) if (role === me.role && seat !== me.seat) add(seat, 8);
  }
  for (const e of view.events) {
    if (e.type === "seerResult") add(e.target, e.team === "wolf" ? 20 : -20);
    if (e.type === "witch" && e.use === "save") add(e.target, -1);
  }

  // 票型：投給可信預言家的人、預言家查殺的人在場卻不投他的人，都像狼
  const seer = me.role === "seer" ? me.seat : trustedSeer;
  if (me.role !== "werewolf" && seer !== null) {
    for (const c of claimDays) if (c.seat === seer && !wolfCheckDay.has(c.target)) wolfCheckDay.set(c.target, c.day);
    for (const e of view.events) if (e.type === "seerResult" && e.team === "wolf") wolfCheckDay.set(e.target, e.day + 1);
    for (const round of votes) {
      const voted = new Set(Object.values(round.votes));
      const known = [...wolfCheckDay].filter(([, day]) => day <= round.day).map(([w]) => w);
      for (const [voter, target] of Object.entries(round.votes)) {
        const v = Number(voter);
        if (v === me.seat || v === seer) continue;
        if (target === seer) add(v, 2);
        else if (known.some((w) => w !== v && voted.has(w)) && (target === null || !known.includes(target))) add(v, 0.7);
      }
    }
  }

  // 發言的踩與保：越可疑的人說的話越不可信，非常可疑的人踩誰，反而替那個人洗白一點
  for (const { speaker, target, tone } of tones) {
    if (speaker === me.seat) continue; // 自己的發言本來就是照這份判斷說的，不重複計算
    const credibility = scores.get(speaker) ?? 0;
    add(target, credibility >= 3 ? -tone * 0.3 : tone / (1 + Math.max(0, credibility)));
  }

  return { score: (seat) => scores.get(seat) ?? 0, claims, seerClaims, trustedSeer, accusations };
}

// 依分數挑人，加一點隨機避免所有 AI 反應一模一樣
export function mostSuspicious(reads: Reads, pool: Seat[], noise = 0.8): Seat | undefined {
  let best: Seat | undefined;
  let bestScore = -Infinity;
  for (const seat of pool) {
    const value = reads.score(seat) + Math.random() * noise;
    if (value > bestScore) [best, bestScore] = [seat, value];
  }
  return best;
}
