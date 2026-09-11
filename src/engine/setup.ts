import { advance, emit, emptyNight, EngineError, rand } from "./machine";
import { BOARD, ROLE_NAME, SEAT_COUNT, type GameState, type Role, type Seat } from "./types";

export interface GameOptions {
  seed: number;
  // 房主指定的角色（練習用），其餘座位從剩下的牌隨機分配
  assigned?: Partial<Record<Seat, Role>>;
}

export function createGame({ seed, assigned = {} }: GameOptions): GameState {
  const s: GameState = {
    day: 0,
    players: [],
    phase: { kind: "night", step: "guard" },
    queue: [{ kind: "startNight" }],
    night: emptyNight(),
    lastGuard: null,
    potions: { antidote: true, poison: true },
    votes: {},
    dawnDeaths: [],
    dayDeaths: [],
    events: [],
    rng: seed >>> 0,
  };

  const pool = (Object.keys(BOARD) as Role[]).flatMap((role) => Array<Role>(BOARD[role]).fill(role));
  for (const [key, role] of Object.entries(assigned)) {
    const seat = Number(key);
    if (!Number.isInteger(seat) || seat < 1 || seat > SEAT_COUNT) throw new EngineError(`沒有 ${key} 號座位`);
    if (!role) continue;
    const i = pool.indexOf(role);
    if (i < 0) throw new EngineError(`指定的${ROLE_NAME[role]}超過板子數量`);
    pool.splice(i, 1);
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    s.players.push({ seat, role: assigned[seat] ?? pool.pop()!, alive: true });
  }

  for (const p of s.players) emit(s, { seats: [p.seat] }, { type: "role", seat: p.seat, role: p.role });
  emit(s, "wolves", { type: "wolfTeam", seats: s.players.filter((p) => p.role === "werewolf").map((p) => p.seat) });

  advance(s);
  return s;
}
