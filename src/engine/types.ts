export type Role = "werewolf" | "villager" | "seer" | "witch" | "hunter" | "guard";
export type Team = "wolf" | "good";
export type Seat = number;

export const SEAT_COUNT = 12;

// 12 人標準局：4 狼、4 民、預言家、女巫、獵人、守衛
export const BOARD: Record<Role, number> = { werewolf: 4, villager: 4, seer: 1, witch: 1, hunter: 1, guard: 1 };
export const GODS: readonly Role[] = ["seer", "witch", "hunter", "guard"];
export const ROLE_NAME: Record<Role, string> = {
  werewolf: "狼人",
  villager: "平民",
  seer: "預言家",
  witch: "女巫",
  hunter: "獵人",
  guard: "守衛",
};

export const teamOf = (role: Role): Team => (role === "werewolf" ? "wolf" : "good");

export type DeathCause = "wolf" | "poison" | "vote" | "shot";

export interface Player {
  seat: Seat;
  role: Role;
  alive: boolean;
  deathCause?: DeathCause;
  deathDay?: number;
}

export type NightStep = "guard" | "wolf" | "witch" | "seer";

// 需要等待玩家輸入（或伺服器 timeout）的階段
export type InteractiveStep =
  | { kind: "night"; step: NightStep }
  | { kind: "hunter"; seat: Seat }
  | { kind: "lastWords"; seat: Seat }
  | { kind: "speech"; seat: Seat; pk: boolean }
  | { kind: "vote"; pk: boolean; candidates: Seat[] | null }
  | { kind: "ended"; winner: Team };

// 自動步驟：進入佇列後立刻執行，不等待輸入
type AutoStep =
  | { kind: "startNight" }
  | { kind: "dawn" }
  | { kind: "checkWin" }
  | { kind: "dawnLastWords" }
  | { kind: "startDay" };

export type Step = InteractiveStep | AutoStep;

// 事件的可見對象；god 只有上帝視角（死者、遊戲結束、觀戰）看得到
export type Audience = "all" | "wolves" | "god" | { seats: Seat[] };
export type SpeechKind = "speech" | "pk" | "lastWords";

export type GameEventBody =
  | { type: "role"; seat: Seat; role: Role }
  | { type: "wolfTeam"; seats: Seat[] }
  | { type: "wolfChat"; seat: Seat; text: string }
  | { type: "wolfVote"; seat: Seat; target: Seat | null }
  | { type: "knife"; target: Seat | null }
  | { type: "witchInfo"; target: Seat | null }
  | { type: "witch"; seat: Seat; use: "save" | "poison"; target: Seat }
  | { type: "guard"; seat: Seat; target: Seat | null }
  | { type: "seerResult"; seat: Seat; target: Seat; team: Team }
  | { type: "dawn"; deaths: Seat[] }
  | { type: "death"; seat: Seat; cause: DeathCause }
  | { type: "speech"; seat: Seat; text: string; kind: SpeechKind }
  | { type: "vote"; pk: boolean; votes: Record<Seat, Seat | null>; exiled: Seat | null; tie: Seat[] }
  | { type: "shot"; seat: Seat; target: Seat | null }
  | { type: "gameOver"; winner: Team };

export type GameEvent = GameEventBody & { day: number; to: Audience };

export interface NightState {
  guard: Seat | null;
  wolfVotes: Record<Seat, Seat | null>;
  knife: Seat | null;
  witchUsed: "save" | "poison" | null;
  poison: Seat | null;
  seerChecked: boolean;
}

export interface GameState {
  day: number;
  players: Player[];
  phase: InteractiveStep;
  queue: Step[];
  night: NightState;
  lastGuard: Seat | null;
  potions: { antidote: boolean; poison: boolean };
  votes: Record<Seat, Seat | null>;
  dawnDeaths: Seat[];
  dayDeaths: Seat[];
  events: GameEvent[];
  rng: number;
}

export type Action =
  | { type: "timeout" }
  | { type: "guard"; seat: Seat; target: Seat | null }
  | { type: "wolfVote"; seat: Seat; target: Seat | null }
  | { type: "wolfChat"; seat: Seat; text: string }
  | { type: "witch"; seat: Seat; use: "save" | "poison" | "none"; target?: Seat }
  | { type: "seerCheck"; seat: Seat; target: Seat }
  | { type: "say"; seat: Seat; text: string }
  | { type: "endSpeech"; seat: Seat }
  | { type: "vote"; seat: Seat; target: Seat | null }
  | { type: "shoot"; seat: Seat; target: Seat | null };
