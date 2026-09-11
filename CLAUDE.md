# 狼人殺 Web App（單人對戰 AI）

手機優先的多人連線狼人殺網頁遊戲。真人玩家開房、用連結邀請朋友加入（1–12 位真人皆可）；開始時空位由 LLM（Groq 上的 Qwen 3.8 27B）驅動的 AI 玩家自動補滿 12 人。系統擔任法官自動主持。

- 語言：繁體中文（UI、AI 發言、法官播報）
- 目標裝置：手機直式（375–430px 寬為主），桌機置中顯示手機寬度版面
- UI 會在後續用 Gemini 生成並調整；元件需保持「邏輯與樣式分離」以便替換外觀

---

## 1. 產品決策（已定案）

| 項目 | 決策 |
|---|---|
| 遊玩型態 | 多人連線：真人玩家人數不限（1–12），開始時空位由 AI 補滿 12 人 |
| 進房方式 | 房主建立房間 → 取得 4 碼房號與分享連結（LINE 等）→ 其他人點連結或輸入房號加入 → 房主按「開始」 |
| 房主權限 | 踢人（僅等待室）、指定某位玩家的角色（練習用，未指定者隨機） |
| 板子 | 12 人標準局：4 狼人、4 平民、預言家、女巫、獵人、守衛 |
| 勝負 | 屠邊 |
| 警長 | **不採用** |
| 帳號 | 免註冊，輸入暱稱即可；裝置產生匿名 playerId（存 localStorage）用於重連 |
| 身份分配 | 隨機，房主可指定特定玩家角色 |
| 即時後端 | **Convex**（已接上；開發時用匿名本機後端，上線前需登入 Convex 建立雲端專案，見 3.2.2） |
| AI 引擎 | 混合式：白天發言／PK／遺言用 Groq 上的 Qwen 3.8 27B（`qwen/qwen3.8-27b`），夜晚行動與投票用規則式 AI（見 3.3）；API key 僅存於伺服器端 |
| AI 個性 | 補位 AI 各有固定人設（名字、頭像、說話風格） |
| 斷線處理 | 真人斷線超過 30 秒 → AI 接管其行動與發言；重連後自動拿回控制權 |
| 發言方式 | 真人：**即時語音 + 語音轉文字**（文字給 AI 讀、也顯示在紀錄）或打字；AI：文字 + TTS 朗讀 |
| 即時語音 | **LiveKit Cloud**；只有目前發言者開麥，其他人靜音；夜晚狼隊的真人玩家之間可語音私聊 |
| 語音轉文字／朗讀 | 瀏覽器 Web Speech API（SpeechRecognition / speechSynthesis），抽象成介面以便日後換雲端 |
| 玩家死亡後 | 上帝視角觀戰（公開全部身份與夜間行動，可加速） |
| 附加功能 | 賽後復盤、戰績紀錄（localStorage）、新手教學、發言計時器 |
| 技術棧 | Next.js（App Router）+ TypeScript + Tailwind，部署 Vercel |
| 視覺基調 | 暗黑哥德月夜：深藍黑底、月光銀白、血紅點綴 |

---

## 2. 遊戲規則（實作以此為準）

### 2.1 陣營與角色
- **狼人陣營（4）**：狼人 ×4。夜晚睜眼互認，共同決定刀一人。
- **神職（4）**：
  - **預言家**：每晚查驗一名存活玩家，得知「好人／狼人」。
  - **女巫**：解藥、毒藥各 1 瓶，全局各限 1 次；**一晚最多用 1 瓶**；**首夜可以自救**，第二夜起不可自救。解藥未用時，法官會告知當晚被刀者；解藥用掉後不再告知。
  - **獵人**：死亡時可開槍帶走一名存活玩家；**被女巫毒死不能開槍**。可以選擇不開槍。
  - **守衛**：每晚守護一人（可自守、可空守），**不可連續兩晚守同一人**。被守者當晚免疫狼刀，但不免疫毒藥。
- **平民（4）**：無技能。

### 2.2 特殊結算
- **同守同救**：守衛守護且女巫解救同一人 → 該玩家仍然**死亡**。
- 被刀又被毒 → 死亡（毒殺，獵人不能開槍）。
- 狼人可以刀任何人，包含狼隊友或自己，也可以空刀（AI 狼一般不這麼做）。

### 2.3 流程
```
準備 → [夜晚] → [天亮公布] → [白天發言] → [投票] → [放逐/遺言] → 勝負檢查 → [夜晚] …
```
**夜晚行動順序**：守衛 → 狼人 → 女巫 → 預言家

**天亮**：公布昨夜死亡名單（多人時依座位號排序，不透露死因）。「平安夜」指無人死亡。
- 首夜死者可發表遺言；第二夜起夜間死者**沒有遺言**。
- 死者若是獵人（且非毒死）→ 公布死訊後開槍，被槍殺者沒有遺言（首夜例外，依首夜遺言規則）。

**白天發言順序**（無警長）：
- 有人夜死 → 從死者座位號 +1 開始順時針輪流發言（跳過死者）。
- 平安夜 → 隨機選起點，順時針輪流發言。
- 每人發言上限 **90 秒**，可提前結束。

**狼人自爆**：**不採用**（2026-09 取消，避免公開狼人身份與強制跳過白天）。

**投票**：所有存活玩家同時投票（可棄票），得票最高者被放逐。
- **平票** → 平票者依序 PK 發言 → 其餘存活玩家（PK 者不投票）重投 → 仍平票則當天無人出局。
- 被放逐者發表遺言；若是獵人，遺言後開槍。

### 2.4 勝負（屠邊）
每次死亡結算後檢查：
1. 狼人全滅 → **好人勝**
2. 神職全滅 **或** 平民全滅 → **狼人勝**

先檢查 1 再檢查 2。獵人開槍的結算完成後才檢查勝負。

---

## 3. 系統架構

### 3.1 資料夾結構（規劃）
```
src/
  app/
    page.tsx                 # 首頁（暱稱、建立房間、輸入房號加入、戰績、教學）
    room/[code]/page.tsx     # 等待室（座位、分享連結、房主踢人／指定角色、開始）
    game/[code]/page.tsx     # 遊戲主畫面
    play/                    # 本機模擬對局（目前的實際遊戲入口，見 3.2.0.1）
    game/page.tsx            # UI 預覽（假資料＋階段切換鈕，給 Gemini 調整畫面用）
    tutorial/page.tsx        # 新手教學
    stats/page.tsx           # 戰績
    api/livekit/route.ts     # 簽發 LiveKit token（依遊戲階段決定能否發佈音訊）
  engine/                    # 純 TypeScript 遊戲引擎，零 UI／零 Convex 依賴、可單元測試
    types.ts                 # Role, Player, Phase, GameState, Action, Event
    setup.ts                 # 洗牌、分配身份（含房主指定角色）
    machine.ts               # 階段狀態機（reducer：state + action → state + events）
    resolve.ts               # 夜晚結算（守／刀／救／毒）
    victory.ts               # 屠邊判定
    visibility.ts            # 依玩家身份過濾可見資訊（防作弊核心，真人與 AI 共用）
  voice/
    tts.ts / stt.ts          # Web Speech 抽象層（介面：speak(text, voice), listen()）
    livekit.ts               # 即時語音連線封裝
  components/                # UI 元件（純呈現，方便用 Gemini 生成的樣式替換）
convex/
  schema.ts                  # rooms, players, games, events, privateEvents
  rooms.ts                   # 建房、加入、踢人、指定角色、開始（補 AI）
  game.ts                    # 提交行動 mutation → 呼叫 engine reducer
  views.ts                   # 依 playerId 回傳「自己視角」的 query
  scheduler.ts               # 階段計時（ctx.scheduler.runAfter），逾時自動推進
  ai.ts                      # action：呼叫 Groq 產生 AI 發言（沿用 src/ai/speech.ts）
  presence.ts                # 心跳、斷線偵測、AI 接管
  ai/personas.ts, ai/prompts.ts
```

### 3.2 遊戲引擎原則
- **伺服器權威**：引擎只在 Convex mutation 中執行；前端只送出「意圖」（例如投票給 3 號），由伺服器驗證合法性。
- 以 reducer + 事件記錄（event log）實作，事件記錄同時用於賽後復盤。
- **防作弊**：客戶端只能透過 `views.ts` 的 query 取得自己視角的資料（身份、夜間私密結果只下發給有權限的玩家）；完整 GameState 絕不下發（死亡後觀戰、遊戲結束時例外）。
- 所有計時（夜晚行動、90 秒發言、投票）由伺服器排程，前端倒數只是顯示用；逾時視為：發言結束／棄票／不行動。
- 夜晚階段固定時長（例如每個角色 20 秒，就算該角色已死或由 AI 扮演也要等），避免從等待時間推敲出身份。
- 所有隨機性使用可注入的 seed RNG，方便測試與重現。

### 3.2.0 引擎實作（`src/engine/`，已完成，`npm test` 執行測試）
- 入口：`createGame({ seed, assigned })` 開局、`reduce(state, action)` 轉移狀態（不合法時丟出 `EngineError`，原狀態不變）、`viewFor(state, seat | "god")` 取得過濾後的視角。
- **流程佇列**：`state.queue` 排好接下來的步驟；`startNight`／`dawn`／`checkWin`／`dawnLastWords`／`startDay` 是自動步驟，`state.phase` 永遠停在需要輸入的階段（夜晚各角色、獵人開槍、遺言、發言、投票、結束）。
- **計時由伺服器負責**：夜晚四個步驟**只能**由 `timeout` 結束，角色的行動只是記錄下來（可以改選）；發言可以用 `endSpeech` 提前結束；投票在所有有投票權的人都投完時自動結算，否則等 `timeout`，沒投的人視為棄票。
- 實作時定下的細節規則：
  - 狼刀：存活狼人票數最高者；平票隨機選一個；沒人投則空刀。
  - 女巫：解藥未用時才收到刀口（`witchInfo`）；毒藥可以毒任何存活玩家。
  - 天亮順序：公布死訊 → 獵人開槍 → 勝負判定 → 首日遺言（包含被獵人帶走的人）→ 發言。
  - 放逐順序：遺言 → 獵人開槍 → 勝負判定 → 夜晚。
  - 無人投票也算「無人出局」，不進 PK。
  - 死者身份不公開（上帝視角除外）。
- 亂數（mulberry32）狀態存在 `state.rng`，同樣的操作序列必得同樣結果，符合 Convex mutation 的確定性要求。

### 3.2.0.1 本機模擬（`src/sim/`、`/play`，Convex 之前的過渡方案）
- `LocalGame`（`src/sim/localGame.ts`）在瀏覽器裡擔任「伺服器」：持有 GameState、依階段時限送出 `timeout`、排程 AI 行動；UI 以 `useSyncExternalStore` 訂閱，只讀 `viewFor(state, 自己的座位)`。
- 時限：夜晚每步 6 秒（固定）、發言 90 秒、遺言 60 秒、投票 30 秒、獵人 15 秒；觀戰時可 2×／4× 加速。
- AI 發言節奏：拿到 LLM 內容就先顯示，再依字數停留（約每 10 字 1 秒，2.5–12 秒）才換下一位。理由：讓玩家讀得完，也讓呼叫頻率約每分鐘 6 次，壓在 Groq 每分鐘 8K token 內（連續快速發言會觸發 429、變回罐頭台詞）。
- `bots.ts` 是規則式 AI，只根據自己的 `viewFor(..., { ignoreDeath: true })` 視角做決定（死後開槍、遺言也不能拿到上帝視角）。發言已接上 Groq（`LocalGame` 的 `SpeechProvider`，失敗時用罐頭台詞）。
- `reads.ts` 是規則式 AI 的「盤邏輯」：用關鍵字從發言解析跳身份、報查驗（金水／查殺）、踩人與保人，再加上票型（投給可信預言家、不跟查殺的人）與自己的私密資訊，算出每個座位的嫌疑分數。可疑的人踩人時份量較低。投票、查驗、用毒、守人、開槍都依這個分數；狼人刀人優先刀跳神職（避開跳獵人的人）、踩過隊友的人，並跟隨隊友的刀口。
  - 模擬 300 局（全部 AI、罐頭發言）：好人勝率從 3% 提升到約 56%，放逐命中狼人從 12% 提升到 55%，女巫毒中狼人約 80%。
- `narrate.ts` 把事件轉成聊天紀錄（法官播報／發言／🔒 私密資訊）。
- 換成 Convex 時：`LocalGame` 的計時與 AI 排程移到 `convex/scheduler.ts`、`convex/ai.ts`，UI 改訂閱 `convex/views.ts`，其餘元件不變。
- 戰績（`src/lib/stats.ts`、`/stats`）：遊戲結束時 `LocalGamePlay` 呼叫 `recordGame`，存入 localStorage `ww:stats`（依 `LocalGame.id` 去重，最多 500 筆）；戰績頁顯示總場數、勝率、連勝、陣營與各角色勝率、最近 10 局，可清除。
- 測試：`src/sim/__tests__/` 用假時鐘讓 12 個座位全交給 AI 跑 20 局，確認每局都能結束。

### 3.2.2 Convex 實作（`convex/`，已完成）
- 開發：`CONVEX_AGENT_MODE=anonymous npx convex dev`（匿名本機後端，port 3210，不需帳號）；Next.js 讀 `.env.local` 的 `NEXT_PUBLIC_CONVEX_URL`。Groq key 用 `npx convex env set GROQ_API_KEY ...` 設在 Convex（不要印出來）。上線前：`npx convex login` 建立雲端專案，再部署到 Vercel。
- `convex/` 直接 import `src/engine`、`src/sim/bots`、`src/ai/speech`（`convex/tsconfig.json` 設了 `@/` 別名）；前端用 `@convex/_generated/api`。
- 資料表（`schema.ts`）：`rooms`（房號、成員 `{pid, id, name}`、房主、指定角色、目前 gameId）、`games`（GameState 存成 JSON 字串、座位 meta、真人座位 `humans`、phaseKey、deadline、計時器 id）、`presence`（心跳）。
  - `pid` 是裝置的匿名 playerId（`src/lib/player.ts`，localStorage `ww:playerId`），等同登入憑證，**只存在伺服器、絕不回傳**；前端看到的是公開的 `id`。
- `rooms.ts`：`get`／`create`／`join`／`leave`／`kick`／`assign`／`start`。開始時真人隨機入座、空位用 AI 補滿，身份揭曉有 12 秒緩衝（`REVEAL_MS`）才開始第一個夜晚步驟的計時。
- `games.ts`：`view` 只回傳 `viewFor(state, 自己的座位)`，不在局裡的人什麼都拿不到；`act` 的座位一律由 playerId 決定，前端不能送 `timeout`；`heartbeat` 每 10 秒一次。內部函式：`tick`（計時到）、`botAct`、`speechContext`／`applySpeech`／`endSpeech`（AI 發言）。
- `flow.ts` 的 `commit()` 取代本機的 `LocalGame`：階段一變就取消舊計時器、排新的（`ctx.scheduler.runAt`），並替 AI 座位（含斷線超過 30 秒的真人）排程行動；排程的函式執行時若 phaseKey 已變就不做事。遊戲結束時房間回到等待室（保留真人）。
- `ai.ts`：`speak` action 呼叫 Groq（`src/ai/groq.ts`，和 `/api/ai/speech` 共用），失敗時用罐頭台詞。
- 前端：`/room/[code]`（`Room.tsx`，即時等待室）、`/game/[code]`（`OnlineGame.tsx`）。遊戲畫面 `src/components/GameScreen.tsx` 由 `GameController` 提供資料，本機模擬（`/play`）與連線對局共用。連線對局不支援觀戰加速。
- 節奏與座位設定（`DURATION`、`botDelay`、`readMs`、`buildSeats`）在 `src/sim/timing.ts`，兩邊共用。
- 尚未做：LiveKit 即時語音、房主以外的人無法「再來一局」（回到等待室由房主按開始）、舊房間清理、Convex 函式的 `convex-test` 測試。

### 3.2.1 房間與連線
- 房號 4 碼（排除易混淆字元），分享連結 `/room/ABCD`。
- 房間狀態：`lobby` → `playing` → `finished`（結束後可「再來一局」回到 lobby，保留真人玩家）。
- 等待室最多 12 位真人；房主可踢人、可指定任一玩家的角色（指定的組合必須符合板子數量）。房主離開則房主轉交給最早加入的真人。
- 房主按「開始」→ 空位依座位補上 AI（隨機抽人設）→ 分配身份 → 進入第 1 夜。遊戲開始後不能再加入（可以之後做觀戰）。
- **斷線**：每 10 秒送一次心跳；超過 30 秒沒有心跳就標記斷線，由 AI 接管（使用同一套 AI 流程，人設採「中性」）；重連後自動拿回控制權。

### 3.3 AI 設計
- **資訊隔離（最重要）**：每位 AI 只收到「自己身份可知」的資訊：
  - 所有人：公開發言、投票結果、死亡公告、自己的身份
  - 狼人：狼隊友是誰、狼人私聊內容、刀人結果
  - 預言家：自己的查驗結果；女巫：當晚刀口（解藥未用時）、用藥紀錄；守衛：自己的守護紀錄
  - **絕不**把完整 GameState 傳給 LLM
- 每次呼叫 Groq 帶入：人設、身份、可見資訊摘要、當前任務（發言／PK 發言／遺言）。夜間行動、投票、開槍用規則式 AI（`src/sim/bots.ts`），只根據自己的視角決定。真人的語音發言以轉出的文字提供給 AI。
- 夜間行動、投票要求 **結構化輸出**（JSON schema，例如 `{ target: number | null, reasoning: string }`）；發言要求自然語言 + 私下推理。
- 私下推理（`reasoning`）存入事件記錄，**只在賽後復盤或上帝視角時顯示**。
- 合法性驗證：LLM 回傳的目標不合法（例如守衛連守同一人、目標已死）時由引擎修正，最多重試 1 次，失敗則隨機選一個合法目標。
- 發言長度控制在約 50–150 字；同一輪 AI 發言依序呼叫（後發言者要能看到前面的發言）。
- **狼人夜晚**：所有狼（真人＋AI）共用「狼隊頻道」（文字；真人狼之間另可用 LiveKit 語音私聊），AI 狼先各自發表意見 → 真人狼可輸入 → 全體存活狼投票決定刀口；平票時從最高票中隨機選一個；時間到仍沒人投票則空刀。
- 模型：Groq 的 OpenAI 相容 API（直接 `fetch`，無額外 SDK），預設 `qwen/qwen3.8-27b`，可用 `GROQ_MODEL` 切換。只讓它產生**純文字發言**，由 `cleanSpeech` 清理；呼叫時帶 `reasoning_effort: "none"` 關閉 Qwen3 的思考模式以節省 token。
  - 選型紀錄（2026-09）：原定 Llama 3.3 70B，但使用者的 Groq 帳號沒有此模型（404 model_not_found）。同情境實測：Qwen 3.8 27B 中文與角色扮演最好（會反咬、帶節奏，約 550 token）；GPT-OSS 120B 較平淡且會編造未發生的事，另耗推理 token。
- **token 預算**：實測此帳號的 `qwen/qwen3.8-27b` 上限為 1,000 次請求／天、8,000 token／分鐘（回應標頭 `x-ratelimit-limit-*`；每日 token 上限未在標頭中提供，以 console 為準）。因此：只有發言交給 LLM（一局約 60 次呼叫）；摘要只放最近 16 句發言與 10 則公告、每句上限 120 字，每次約 1.5K token → 一局約 9 萬 token，免費方案約一天一局。超過額度（HTTP 429）時自動改用罐頭台詞。
- 實作：`src/ai/speech.ts`（`buildSpeechRequest` 依 AI 自己的視角整理摘要，遺言時用 `viewFor(..., { ignoreDeath: true })` 避免洩漏上帝視角；`validateSpeechRequest` 伺服器端驗證；`buildMessages` 組 prompt）、`src/app/api/ai/speech/route.ts`（唯一接觸 key 的地方，含每 IP 速率限制與大小限制）、`src/ai/client.ts`（前端呼叫）。
- 環境變數：`GROQ_API_KEY`、`GROQ_MODEL`（本機放 `.env.local`，範本見 `.env.example`；上 Convex 後改設在 Convex 環境變數）；`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`（Vercel 環境變數）；不可 commit。

### 3.4 AI 人設池（11 位，補位時依空位數隨機抽取）
每位 AI 有：名字、說話風格、TTS 語音參數（pitch / rate，盡量搭配不同的 zh-TW 語音）。

**頭像池**：`public/avatars/01.jpeg`–`24.jpeg`（1:1 肖像）。每局開始時，從池中不重複隨機分配給 12 個座位（真人與 AI 相同規則）。頭像只在等待室到結算期間固定，下一局重抽。頭像不得帶有任何角色暗示（帽子、兜帽、水晶球、藥瓶、盔甲、武器、狼的特徵）。

| # | 名字 | 風格 |
|---|---|---|
| 1 | 阿烈 | 衝動直率，愛踩人，常第一個跳身份 |
| 2 | 墨白 | 冷靜邏輯派，愛盤票型 |
| 3 | 小滿 | 新手感，容易跟風，發言短 |
| 4 | 老K | 老江湖，愛帶節奏，說話篤定 |
| 5 | 詩詩 | 溫柔謹慎，常說「我再聽聽」 |
| 6 | 鐵柱 | 耿直憨厚，重情緒不重邏輯 |
| 7 | 夜鶯 | 神秘寡言，偶爾一語中的 |
| 8 | 阿哲 | 愛講數據跟機率，理性到冷漠 |
| 9 | 糖糖 | 活潑愛開玩笑，容易被懷疑 |
| 10 | 將軍 | 強勢指揮型，愛安排發言與歸票 |
| 11 | 蘇蘇 | 敏感多疑，懷疑每一個人 |

人設只影響語氣和傾向，不影響規則；身份每局隨機分配。

### 3.5 語音
- **法官播報**：天黑請閉眼、各角色請睜眼（只播與玩家有關的內容或一般氛圍語）、天亮公布死訊、投票結果等。
- **聲音實作**（`src/voice/audio.ts`）：
  - 設定存 localStorage（`ww:audio`：法官播報、AI 自動朗讀、音效、背景音樂、音量），設定頁以 `useSyncExternalStore` 讀寫。
  - 音效 11 種（click、tick、flip、night、howl、bell、vote、death、gunshot、win、lose）：`public/sounds/<名稱>.mp3` 存在就播音檔，否則用 Web Audio 合成（先 HEAD 偵測、結果快取）。
  - 背景音樂 `public/sounds/bgm-{night,day,result}.mp3`，沒有音檔就靜音，切換時淡入淡出。
  - 法官與 AI 朗讀共用瀏覽器朗讀佇列；AI 朗讀開啟時，`LocalGame` 的 `Narrator` 等念完才換下一位（加速觀戰時不朗讀）。
  - 觸發點（`LocalGamePlay`）：階段切換（背景音樂、夜晚台詞＋狼嚎）、公開事件（天亮鐘聲、投票、槍聲、勝負）、自己出局、輪到自己時最後 5 秒滴答、翻牌、按鈕。只播公開資訊，不可從聲音洩漏身份。
  - iOS：翻牌與「開始遊戲」點擊時呼叫 `unlockAudio()`。
- **AI 發言朗讀**：用 speechSynthesis 依人設調整聲音；可在設定中關閉，或開啟「文字逐字出現」同步顯示。
- **真人即時語音（LiveKit）**：每個房間一個 LiveKit room。`/api/livekit` 簽發 token 時，依伺服器上的遊戲狀態決定權限：只有「目前發言者」（含遺言、PK 發言）可以發佈音訊，夜晚只有存活的真人狼可以在狼隊子頻道發佈；其他人只能收聽。死者或觀戰者只能收聽，不能發言。
- **語音轉文字**：發言者開麥時同時跑 SpeechRecognition（`lang: 'zh-TW'`），把逐段文字寫入發言紀錄，讓 AI 能「聽懂」真人發言。發言者可以在結束發言前修正文字。不支援的瀏覽器（部分 iOS Safari）要提示使用者補打重點文字。
- iOS 限制：TTS 必須在使用者手勢後才能啟用 → 在「開始遊戲」按鈕上先解鎖音訊。

---

## 4. 畫面（手機直式）

1. **首頁**：標題、暱稱輸入、建立房間、輸入房號加入、新手教學、戰績、設定
2. **等待室**：房號、分享連結按鈕、12 個座位（真人／「AI 補位」空位）、房主可以踢人與指定角色、開始遊戲
2.5. **設定**：語音開關、TTS 速度、發言動畫速度、麥克風測試
3. **身份揭曉**：翻牌動畫顯示身份與技能說明
4. **遊戲主畫面**：
   - 頂部：天數、階段（夜晚／白天／投票）、倒數計時
   - 中間：12 座位圓桌或 3×4 格（頭像、號碼、存活狀態、發言中的高亮）
   - 下方：發言紀錄（聊天泡泡，AI 發言可重播語音）
   - 底部行動區：依階段切換（文字輸入＋麥克風＋結束發言／選擇目標／投票）
5. **夜晚行動**：依身份顯示操作（守衛選人、狼隊頻道＋刀人、女巫解藥／毒藥、預言家查驗）；非行動角色顯示等待畫面
6. **投票**：選擇玩家或棄票，公布票型
7. **死亡／觀戰**：切換上帝視角，顯示所有身份、夜間行動、AI 私下推理，可 2× / 4× 加速
8. **結算與復盤**：勝負、全員身份、每天的時間軸（夜間行動、發言、票型、AI 推理）
9. **戰績**：總場數、勝率、各角色勝率、陣營勝率
10. **新手教學**：規則、角色卡、流程圖

### 視覺規範（初版，後續交給 Gemini 調整）
- 色彩：背景 `#0a0e1a`、面板 `#141a2e`、月光 `#e8e6f0`、血紅 `#b3122e`、金色點綴 `#c9a45c`、狼陣營紅／好人陣營藍
- 字型：標題用有襯線字（Noto Serif TC），內文用 Noto Sans TC
- 夜晚／白天有明顯的背景切換（夜：月亮與暗霧；日：暗琥珀光），1 秒淡入淡出
- 美術素材（全部為 Gemini 生成）：
  - `public/moon.jpeg`：首頁主視覺
  - `public/roles/*.jpeg`：6 張角色卡 + `back.jpeg` 卡背
  - `public/avatars/01–24.jpeg`：頭像池
  - `public/scenes/`：`night`、`day`（遊戲背景 9:16）；`good-win`、`wolf-win`（結算）；`dead`（出局）；`dawn`（天亮過場）
  - 新素材請沿用同一套風格描述：dark gothic fantasy、painterly、深藍黑 `#0a0e1a`、月亮血紅光環、古金 `#c9a45c`
- 觸控目標至少 44px；需考慮 safe-area（iPhone 瀏海／底部橫條）

---

## 5. 開發規範
- TypeScript strict；引擎邏輯需有單元測試（Vitest），尤其是夜晚結算、勝負、平票 PK、獵人開槍。
- UI 元件不直接呼叫引擎內部函式，只透過 store 派發 action。
- 不在前端暴露任何 API key；所有 mutation 都要驗證 playerId 是否屬於該房間、是否輪到他、行動是否合法。
- 單元測試要涵蓋 `engine/`；Convex 函式用 `convex-test` 測試房間流程與權限。
- 所有使用者可見文字使用繁體中文。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
