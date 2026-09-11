import { teamOf, type Role, type Team } from "@/engine";

// 戰績存在 localStorage（免註冊，只記在這台裝置）；useSyncExternalStore 相容的小型 store

export interface GameRecord {
  id: string;
  at: number; // 結束時間（ms）
  role: Role;
  winner: Team;
  won: boolean;
  survived: boolean;
  days: number;
}

export interface RoleStat {
  games: number;
  wins: number;
}

const STORAGE_KEY = "ww:stats";
const MAX_RECORDS = 500;
const EMPTY: GameRecord[] = [];

let records: GameRecord[] | null = null;
const listeners = new Set<() => void>();

const isRecord = (r: unknown): r is GameRecord =>
  typeof r === "object" && r !== null && typeof (r as GameRecord).id === "string" && typeof (r as GameRecord).role === "string";

export function getRecords(): GameRecord[] {
  if (!records) {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      records = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
      records = [];
    }
  }
  return records;
}

export const getServerRecords = () => EMPTY;

export function subscribeRecords(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(next: GameRecord[]) {
  records = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

// 同一局只記一次（React 開發模式的 effect 會跑兩次）
export function recordGame(record: Omit<GameRecord, "won" | "at">) {
  const all = getRecords();
  if (all.some((r) => r.id === record.id)) return;
  save([...all, { ...record, won: teamOf(record.role) === record.winner, at: Date.now() }].slice(-MAX_RECORDS));
}

export function clearRecords() {
  save([]);
}

export function summarize(list: GameRecord[]) {
  const byRole = {} as Record<Role, RoleStat>;
  const byTeam: Record<Team, RoleStat> = { good: { games: 0, wins: 0 }, wolf: { games: 0, wins: 0 } };
  let streak = 0;
  let bestStreak = 0;
  for (const r of list) {
    const role = (byRole[r.role] ??= { games: 0, wins: 0 });
    const team = byTeam[teamOf(r.role)];
    role.games++;
    team.games++;
    if (r.won) {
      role.wins++;
      team.wins++;
      bestStreak = Math.max(bestStreak, ++streak);
    } else {
      streak = 0;
    }
  }
  const wins = list.filter((r) => r.won).length;
  return { games: list.length, wins, byRole, byTeam, streak, bestStreak };
}

export const rate = (s: { games: number; wins: number }) => (s.games ? Math.round((s.wins / s.games) * 100) : 0);
