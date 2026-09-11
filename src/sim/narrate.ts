import type { ChatMessage } from "@/components/ChatLog";
import { ROLE_NAME, type GameEvent, type GameView, type Seat } from "@/engine";
import type { SeatMeta } from "./localGame";

const CAUSE = { wolf: "被狼人殺害", poison: "被女巫毒殺", vote: "被投票放逐", shot: "被獵人帶走" } as const;

// 把玩家視角的事件轉成聊天紀錄（法官播報、發言、只有自己看得到的私密資訊）
export function narrate(view: GameView, meta: SeatMeta[]): ChatMessage[] {
  const n = (seat: Seat | null) => (seat === null ? "沒有人" : `${seat} 號 ${meta[seat - 1].name}`);
  const out: ChatMessage[] = [];
  let day = 0;

  for (const e of view.events) {
    // 開局事件（身份、狼隊）記在第 0 天，歸入第 1 夜顯示
    if (Math.max(e.day, 1) > day) {
      day = Math.max(e.day, 1);
      out.push({ kind: "judge", text: `🌙 第 ${day} 夜・天黑請閉眼` });
    }
    switch (e.type) {
      case "role":
        if (e.seat === view.you?.seat) out.push({ kind: "private", text: `你的身份是${ROLE_NAME[e.role]}` });
        break;
      case "wolfTeam":
        out.push({ kind: "private", text: `狼隊：${e.seats.map((s) => `${s} 號`).join("、")}` });
        break;
      case "wolfChat":
        out.push({ kind: "speech", seat: e.seat, text: e.text, tag: "🐺 狼隊" });
        break;
      case "wolfVote":
        out.push({ kind: "private", text: `${n(e.seat)} 投刀 ${n(e.target)}` });
        break;
      case "knife":
        out.push({ kind: "private", text: e.target === null ? "狼隊今晚空刀" : `狼隊決定刀 ${n(e.target)}` });
        break;
      case "witchInfo":
        out.push({ kind: "private", text: e.target === null ? "今晚沒有人被刀" : `今晚被刀的是 ${n(e.target)}` });
        break;
      case "witch":
        out.push({ kind: "private", text: e.use === "save" ? `女巫用解藥救了 ${n(e.target)}` : `女巫毒了 ${n(e.target)}` });
        break;
      case "guard":
        out.push({ kind: "private", text: e.target === null ? "守衛今晚空守" : `守衛守護了 ${n(e.target)}` });
        break;
      case "seerResult":
        out.push({ kind: "private", text: `預言家查驗 ${n(e.target)}：${e.team === "wolf" ? "狼人" : "好人"}` });
        break;
      case "dawn":
        out.push({
          kind: "judge",
          text: e.deaths.length ? `天亮了，昨晚死亡的是 ${e.deaths.map((s) => n(s)).join("、")}` : "天亮了，昨晚是平安夜",
        });
        break;
      case "death":
        out.push({ kind: "private", text: `${n(e.seat)} ${CAUSE[e.cause]}` });
        break;
      case "speech":
        out.push({ kind: "speech", seat: e.seat, text: e.text, tag: e.kind === "lastWords" ? "遺言" : e.kind === "pk" ? "PK" : undefined });
        break;
      case "vote":
        out.push(voteCard(e, n));
        break;
      case "shot":
        out.push({ kind: "judge", text: e.target === null ? `${n(e.seat)} 選擇不開槍` : `${n(e.seat)} 開槍帶走了 ${n(e.target)}` });
        break;
      case "gameOver":
        out.push({ kind: "judge", text: `遊戲結束：${e.winner === "good" ? "好人" : "狼人"}勝利` });
        break;
    }
  }
  return out;
}

// 投票結果整理成卡片資料：依票數排序，最高票標記出來
function voteCard(e: Extract<GameEvent, { type: "vote" }>, n: (seat: Seat | null) => string): ChatMessage {
  const byTarget = new Map<Seat, Seat[]>();
  const abstain: Seat[] = [];
  for (const [voter, target] of Object.entries(e.votes)) {
    if (target === null) abstain.push(Number(voter));
    else byTarget.set(target, [...(byTarget.get(target) ?? []), Number(voter)]);
  }
  const max = Math.max(0, ...[...byTarget.values()].map((v) => v.length));
  const rows = [...byTarget]
    .map(([target, voters]) => ({ target, voters: voters.sort((a, b) => a - b), top: voters.length === max }))
    .sort((a, b) => b.voters.length - a.voters.length || a.target - b.target);

  const result =
    e.exiled !== null
      ? `${n(e.exiled)} 被放逐`
      : e.tie.length > 1 && !e.pk
        ? `${e.tie.join("、")} 號平票，進入 PK`
        : e.tie.length > 1
          ? "PK 仍然平票，今天無人出局"
          : "無人投票，今天無人出局";
  return { kind: "vote", pk: e.pk, result, exiled: e.exiled !== null, rows, abstain: abstain.sort((a, b) => a - b) };
}
