// UI 原型用的假資料。正式版會改由 src/engine 與 src/ai 提供。
import type { ChatMessage } from "@/components/ChatLog";
import { avatarUrl } from "./avatars";

export type Role = "werewolf" | "villager" | "seer" | "witch" | "hunter" | "guard";
export type Team = "wolf" | "good";

export const roleImage = (role: Role) => `/roles/${role}.jpeg`;
export const CARD_BACK = "/roles/back.jpeg";

export const ROLE_INFO: Record<Role, { name: string; team: Team; icon: string; desc: string }> = {
  werewolf: { name: "狼人", team: "wolf", icon: "🐺", desc: "每晚與狼隊友商議刀殺一名玩家。白天隱藏身份，混在好人之中。" },
  villager: { name: "平民", team: "good", icon: "🧑‍🌾", desc: "沒有技能，靠發言與投票找出狼人。" },
  seer: { name: "預言家", team: "good", icon: "🔮", desc: "每晚查驗一名玩家是好人還是狼人。" },
  witch: { name: "女巫", team: "good", icon: "🧪", desc: "解藥、毒藥各一瓶，一晚限用一瓶。首夜可自救。" },
  hunter: { name: "獵人", team: "good", icon: "🏹", desc: "出局時可開槍帶走一人；被毒死則不能開槍。" },
  guard: { name: "守衛", team: "good", icon: "🛡️", desc: "每晚守護一人免於狼刀，不可連續兩晚守同一人。" },
};

export type Player = {
  seat: number;
  name: string;
  avatar: string;
  role: Role;
  alive: boolean;
  isUser?: boolean;
  isAI?: boolean;
  offline?: boolean;
};

// 原型用固定頭像（避免 SSR/CSR 不一致）；正式版每局以 drawAvatars() 隨機分配
export const PLAYERS: Player[] = [
  { seat: 1, name: "阿烈", avatar: avatarUrl(7), role: "villager", alive: true, isAI: true },
  { seat: 2, name: "小安", avatar: avatarUrl(4), role: "seer", alive: true },
  { seat: 3, name: "小滿", avatar: avatarUrl(15), role: "werewolf", alive: true, isAI: true },
  { seat: 4, name: "老K", avatar: avatarUrl(23), role: "hunter", alive: true, isAI: true },
  { seat: 5, name: "你", avatar: avatarUrl(1), role: "witch", alive: true, isUser: true },
  { seat: 6, name: "詩詩", avatar: avatarUrl(11), role: "villager", alive: false, isAI: true },
  { seat: 7, name: "鐵柱", avatar: avatarUrl(2), role: "werewolf", alive: true, isAI: true },
  { seat: 8, name: "Momo", avatar: avatarUrl(18), role: "guard", alive: true },
  { seat: 9, name: "阿哲", avatar: avatarUrl(16), role: "villager", alive: true, isAI: true },
  { seat: 10, name: "Leo", avatar: avatarUrl(24), role: "werewolf", alive: true, offline: true },
  { seat: 11, name: "將軍", avatar: avatarUrl(17), role: "werewolf", alive: true, isAI: true },
  { seat: 12, name: "蘇蘇", avatar: avatarUrl(19), role: "villager", alive: true, isAI: true },
];

// 等待室假資料：真人玩家（其餘空位開始時由 AI 補上）
export const LOBBY = [
  { id: "p1", name: "小安", avatar: avatarUrl(4), host: true },
  { id: "me", name: "你", avatar: avatarUrl(1), host: false },
  { id: "p3", name: "Momo", avatar: avatarUrl(18), host: false },
  { id: "p4", name: "Leo", avatar: avatarUrl(24), host: false },
];

export type Message = ChatMessage;

export const MESSAGES: Message[] = [
  { kind: "judge", text: "天亮了。昨晚死亡的是 6 號 詩詩。" },
  { kind: "speech", seat: 6, text: "（遺言）我是平民，昨晚什麼都不知道就走了。大家注意 3 號，他剛才入座就一直東張西望。" },
  { kind: "judge", text: "從 7 號開始順時針發言。" },
  {
    kind: "speech",
    seat: 7,
    text: "我是好人啦，第一天沒什麼資訊。詩詩點了 3 號，我覺得有點道理，先聽聽 3 號怎麼說。",
    reasoning: "我是狼，3 號是隊友。先假裝附和遺言，之後再幫 3 號洗白。",
  },
  {
    kind: "speech",
    seat: 8,
    text: "（語音轉文字）呃…我覺得 7 號附和得太快了，有點刻意。",
  },
  {
    kind: "speech",
    seat: 9,
    text: "從機率上看，12 個人裡有 4 狼，隨便點一個是狼的機率是三分之一。我需要更多資訊，這輪先聽預言家。",
  },
  {
    kind: "vote",
    pk: false,
    result: "5、8、10、12 號平票，進入 PK",
    exiled: false,
    rows: [
      { target: 5, voters: [1, 8], top: true },
      { target: 8, voters: [5, 11], top: true },
      { target: 10, voters: [6, 12], top: true },
      { target: 12, voters: [7, 10], top: true },
      { target: 2, voters: [3], top: false },
      { target: 4, voters: [2], top: false },
      { target: 6, voters: [9], top: false },
      { target: 11, voters: [4], top: false },
    ],
    abstain: [],
  },
];

export const PERSONA_VOICES: Record<number, { pitch: number; rate: number }> = {
  1: { pitch: 1.1, rate: 1.2 },
  2: { pitch: 0.9, rate: 1.0 },
  3: { pitch: 1.4, rate: 1.1 },
  4: { pitch: 0.7, rate: 0.95 },
  6: { pitch: 1.3, rate: 0.95 },
  7: { pitch: 0.6, rate: 1.0 },
  8: { pitch: 1.0, rate: 0.85 },
  9: { pitch: 0.9, rate: 1.15 },
  10: { pitch: 1.5, rate: 1.25 },
  11: { pitch: 0.65, rate: 1.05 },
  12: { pitch: 1.2, rate: 1.1 },
};
