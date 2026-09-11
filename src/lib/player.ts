// 免註冊的玩家身分：暱稱與裝置的匿名 playerId 都存在 localStorage。
// playerId 等同登入憑證（用來重連、確認是不是房主），不要顯示或分享給別人。

const NICKNAME_KEY = "ww:nickname";
const PLAYER_ID_KEY = "ww:playerId";

export function readNickname(fallback = ""): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) || fallback;
  } catch {
    return fallback;
  }
}

export function saveNickname(name: string) {
  try {
    localStorage.setItem(NICKNAME_KEY, name);
  } catch {}
}

let memoryId: string | null = null;

export function getPlayerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    // 無痕模式等無法寫入時，這個分頁內用同一個 id
    return (memoryId ??= crypto.randomUUID());
  }
}
