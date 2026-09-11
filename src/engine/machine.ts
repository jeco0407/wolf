import { nextRandom } from "./rng";
import { resolveNight } from "./resolve";
import {
  ROLE_NAME,
  SEAT_COUNT,
  teamOf,
  type Action,
  type Audience,
  type DeathCause,
  type GameEventBody,
  type GameState,
  type InteractiveStep,
  type NightState,
  type NightStep,
  type Player,
  type Role,
  type Seat,
  type SpeechKind,
  type Step,
} from "./types";
import { winnerOf } from "./victory";

export class EngineError extends Error {}

function fail(message: string): never {
  throw new EngineError(message);
}

export const emptyNight = (): NightState => ({
  guard: null,
  wolfVotes: {},
  knife: null,
  witchUsed: null,
  poison: null,
  seerChecked: false,
});

// 唯一的狀態轉移入口：不合法的行動丟出 EngineError，原狀態不受影響
export function reduce(prev: GameState, action: Action): GameState {
  if (prev.phase.kind === "ended") fail("遊戲已結束");
  const s = structuredClone(prev);
  apply(s, action);
  return s;
}

// ---- 共用工具 ----

export function emit(s: GameState, to: Audience, body: GameEventBody) {
  s.events.push({ ...body, day: s.day, to });
}

export function rand(s: GameState): number {
  const [value, next] = nextRandom(s.rng);
  s.rng = next;
  return value;
}

const pick = <T>(s: GameState, items: T[]): T => items[Math.floor(rand(s) * items.length)];

export function findPlayer(s: GameState, seat: Seat): Player {
  return s.players.find((p) => p.seat === seat) ?? fail(`沒有 ${seat} 號座位`);
}

const aliveSeats = (s: GameState) => s.players.filter((p) => p.alive).map((p) => p.seat);

function requireAlive(s: GameState, seat: Seat): Player {
  const p = findPlayer(s, seat);
  if (!p.alive) fail(`${seat} 號已經出局`);
  return p;
}

function requireActor(s: GameState, seat: Seat, role: Role): Player {
  const p = requireAlive(s, seat);
  if (p.role !== role) fail(`${seat} 號不是${ROLE_NAME[role]}`);
  return p;
}

function expectNight(s: GameState, step: NightStep) {
  if (s.phase.kind !== "night" || s.phase.step !== step) fail("現在不是這個角色的行動時間");
}

function expectSpeaker(s: GameState, seat: Seat): SpeechKind {
  const st = s.phase;
  if ((st.kind === "speech" || st.kind === "lastWords") && st.seat === seat) {
    return st.kind === "lastWords" ? "lastWords" : st.pk ? "pk" : "speech";
  }
  return fail("現在不是你的發言時間");
}

function kill(s: GameState, seat: Seat, cause: DeathCause) {
  const p = findPlayer(s, seat);
  if (!p.alive) return;
  p.alive = false;
  p.deathCause = cause;
  p.deathDay = s.day;
  s.dayDeaths.push(seat);
  emit(s, "god", { type: "death", seat, cause });
}

// 獵人出局可開槍，被毒死則不行
const hunterStep = (p: Player): Step[] =>
  p.role === "hunter" && p.deathCause !== "poison" ? [{ kind: "hunter", seat: p.seat }] : [];

function topOf(tally: Map<Seat, number>): Seat[] {
  const max = Math.max(0, ...tally.values());
  if (max === 0) return [];
  return [...tally]
    .filter(([, n]) => n === max)
    .map(([seat]) => seat)
    .sort((a, b) => a - b);
}

// ---- 行動 ----

function apply(s: GameState, a: Action) {
  switch (a.type) {
    case "timeout":
      return onTimeout(s);

    case "guard": {
      expectNight(s, "guard");
      requireActor(s, a.seat, "guard");
      if (a.target !== null) {
        requireAlive(s, a.target);
        if (a.target === s.lastGuard) fail("不可連續兩晚守護同一人");
      }
      s.night.guard = a.target;
      return;
    }

    case "wolfVote": {
      expectNight(s, "wolf");
      requireActor(s, a.seat, "werewolf");
      if (a.target !== null) requireAlive(s, a.target);
      s.night.wolfVotes[a.seat] = a.target;
      emit(s, "wolves", { type: "wolfVote", seat: a.seat, target: a.target });
      return;
    }

    case "wolfChat": {
      expectNight(s, "wolf");
      requireActor(s, a.seat, "werewolf");
      emit(s, "wolves", { type: "wolfChat", seat: a.seat, text: a.text });
      return;
    }

    case "witch":
      return witch(s, a);

    case "seerCheck": {
      expectNight(s, "seer");
      requireActor(s, a.seat, "seer");
      if (s.night.seerChecked) fail("今晚已經查驗過了");
      const target = requireAlive(s, a.target);
      s.night.seerChecked = true;
      emit(s, { seats: [a.seat] }, { type: "seerResult", seat: a.seat, target: a.target, team: teamOf(target.role) });
      return;
    }

    case "say": {
      const kind = expectSpeaker(s, a.seat);
      emit(s, "all", { type: "speech", seat: a.seat, text: a.text, kind });
      return;
    }

    case "endSpeech":
      expectSpeaker(s, a.seat);
      return advance(s);

    case "vote": {
      const st = s.phase;
      if (st.kind !== "vote") return fail("現在不是投票時間");
      const voters = eligibleVoters(s, st);
      if (!voters.includes(a.seat)) fail("你這輪不能投票");
      if (a.target !== null) {
        requireAlive(s, a.target);
        if (st.candidates && !st.candidates.includes(a.target)) fail("只能投給 PK 台上的玩家");
      }
      s.votes[a.seat] = a.target;
      if (voters.every((v) => v in s.votes)) resolveVote(s, st);
      return;
    }

    case "shoot": {
      const st = s.phase;
      if (st.kind !== "hunter" || st.seat !== a.seat) return fail("現在不能開槍");
      if (a.target !== null) {
        if (a.target === a.seat) fail("不能對自己開槍");
        requireAlive(s, a.target);
        kill(s, a.target, "shot");
      }
      emit(s, "all", { type: "shot", seat: a.seat, target: a.target });
      return advance(s);
    }
  }
}

function witch(s: GameState, a: Extract<Action, { type: "witch" }>) {
  expectNight(s, "witch");
  requireActor(s, a.seat, "witch");
  if (a.use === "none") return;
  if (s.night.witchUsed) fail("一晚只能使用一瓶藥");

  if (a.use === "save") {
    const knife = s.night.knife;
    if (!s.potions.antidote) fail("解藥已經用過了");
    if (knife === null) return fail("今晚沒有人被刀");
    if (knife === a.seat && s.day > 1) fail("第二夜起不能自救");
    s.potions.antidote = false;
    s.night.witchUsed = "save";
    emit(s, { seats: [a.seat] }, { type: "witch", seat: a.seat, use: "save", target: knife });
    return;
  }

  if (!s.potions.poison) fail("毒藥已經用過了");
  if (a.target === undefined) return fail("請選擇要毒的玩家");
  requireAlive(s, a.target);
  s.potions.poison = false;
  s.night.witchUsed = "poison";
  s.night.poison = a.target;
  emit(s, { seats: [a.seat] }, { type: "witch", seat: a.seat, use: "poison", target: a.target });
}

// 夜晚各步驟只由伺服器 timeout 結束（固定時長，避免從等待時間推敲身份）
function onTimeout(s: GameState) {
  const st = s.phase;
  if (st.kind === "vote") return resolveVote(s, st);
  if (st.kind === "night" && st.step === "wolf") settleKnife(s);
  if (st.kind === "hunter") emit(s, "all", { type: "shot", seat: st.seat, target: null });
  advance(s);
}

// 刀口：存活狼人的票數最高者；平票隨機；沒人投則空刀
function settleKnife(s: GameState) {
  const tally = new Map<Seat, number>();
  for (const [wolf, target] of Object.entries(s.night.wolfVotes)) {
    if (target !== null && findPlayer(s, Number(wolf)).alive) tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  const top = topOf(tally);
  s.night.knife = top.length ? pick(s, top) : null;
  emit(s, "wolves", { type: "knife", target: s.night.knife });

  const witchPlayer = s.players.find((p) => p.role === "witch" && p.alive);
  if (witchPlayer && s.potions.antidote) emit(s, { seats: [witchPlayer.seat] }, { type: "witchInfo", target: s.night.knife });
}

type VoteStep = Extract<InteractiveStep, { kind: "vote" }>;

// PK 投票時，台上的玩家不能投票
const eligibleVoters = (s: GameState, st: VoteStep) => aliveSeats(s).filter((seat) => !st.candidates?.includes(seat));

function resolveVote(s: GameState, st: VoteStep) {
  const votes: Record<Seat, Seat | null> = {};
  for (const voter of eligibleVoters(s, st)) votes[voter] = s.votes[voter] ?? null;
  s.votes = {};

  const tally = new Map<Seat, number>();
  for (const target of Object.values(votes)) if (target !== null) tally.set(target, (tally.get(target) ?? 0) + 1);
  const top = topOf(tally);

  if (top.length === 1) {
    const exiled = top[0];
    emit(s, "all", { type: "vote", pk: st.pk, votes, exiled, tie: [] });
    kill(s, exiled, "vote");
    // 被放逐者先發表遺言，獵人遺言後開槍，開槍結算完才判勝負
    s.queue = [{ kind: "lastWords", seat: exiled }, ...hunterStep(findPlayer(s, exiled)), { kind: "checkWin" }, { kind: "startNight" }];
  } else if (top.length > 1 && !st.pk) {
    emit(s, "all", { type: "vote", pk: false, votes, exiled: null, tie: top });
    s.queue = [...top.map((seat): Step => ({ kind: "speech", seat, pk: true })), { kind: "vote", pk: true, candidates: top }];
  } else {
    // PK 後仍平票，或無人投票：當天無人出局
    emit(s, "all", { type: "vote", pk: st.pk, votes, exiled: null, tie: top });
    s.queue = [{ kind: "startNight" }];
  }
  advance(s);
}

// ---- 流程推進 ----

export function advance(s: GameState) {
  for (;;) {
    const next = s.queue.shift();
    if (!next) return fail("流程佇列為空");
    switch (next.kind) {
      case "startNight":
        startNight(s);
        break;
      case "dawn":
        dawn(s);
        break;
      case "checkWin": {
        const winner = winnerOf(s.players);
        if (winner) {
          s.queue = [];
          emit(s, "all", { type: "gameOver", winner });
          s.phase = { kind: "ended", winner };
          return;
        }
        break;
      }
      case "dawnLastWords":
        // 只有首夜死者（含被獵人帶走的人）有遺言
        if (s.day === 1) s.queue.unshift(...s.dayDeaths.map((seat): Step => ({ kind: "lastWords", seat })));
        break;
      case "startDay":
        startDay(s);
        break;
      default:
        s.phase = next;
        return;
    }
  }
}

function startNight(s: GameState) {
  s.day += 1;
  s.night = emptyNight();
  s.dawnDeaths = [];
  s.dayDeaths = [];
  const steps: NightStep[] = ["guard", "wolf", "witch", "seer"];
  s.queue = [...steps.map((step): Step => ({ kind: "night", step })), { kind: "dawn" }];
}

function dawn(s: GameState) {
  const { night } = s;
  const deaths = resolveNight({ knife: night.knife, guard: night.guard, saved: night.witchUsed === "save", poison: night.poison });

  const guardPlayer = s.players.find((p) => p.role === "guard" && p.alive);
  if (guardPlayer) emit(s, { seats: [guardPlayer.seat] }, { type: "guard", seat: guardPlayer.seat, target: night.guard });
  s.lastGuard = night.guard;

  for (const d of deaths) kill(s, d.seat, d.cause);
  s.dawnDeaths = deaths.map((d) => d.seat);
  emit(s, "all", { type: "dawn", deaths: s.dawnDeaths });

  const hunter = s.dawnDeaths.flatMap((seat) => hunterStep(findPlayer(s, seat)));
  s.queue = [...hunter, { kind: "checkWin" }, { kind: "dawnLastWords" }, { kind: "startDay" }];
}

// 有人夜死：從第一位死者的下一個座位順時針發言；平安夜隨機起點
function startDay(s: GameState) {
  const seats = aliveSeats(s).sort((a, b) => a - b);
  const start = s.dawnDeaths.length ? (s.dawnDeaths[0] % SEAT_COUNT) + 1 : pick(s, seats);
  const from = seats.findIndex((seat) => seat >= start);
  const order = from <= 0 ? seats : [...seats.slice(from), ...seats.slice(0, from)];
  s.queue = [...order.map((seat): Step => ({ kind: "speech", seat, pk: false })), { kind: "vote", pk: false, candidates: null }];
}
