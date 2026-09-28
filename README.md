# Game Trend Radar

Steam 新作關注度、發售月曆與個人收藏。純 HTML / CSS / JavaScript，GitHub Pages 可直接提供網站，不需前端建置或 API Key。

## 頁面與操作

- `index.html`：直接進入發售月曆，下方為即將上市精選與近期上市。月曆每天顯示關注度最高的兩款；可直接選月份，點日期查看完整清單，點遊戲開啟站內詳細頁。
- `upcoming.html`：未來 45 天、至少 5,000 人關注的新作。
- `released.html`：近 30 天的已收錄遊戲；沿用正式清單與經驗證近期黑馬的既有條件。
- `date.html?date=YYYY-MM-DD`：指定日期的完整清單，返回時保留月份。
- `game.html?appid=...`：遊戲主題配色、大圖放大、發售資訊卡、語言支援與收藏。點選 TAG 切換同類型推薦；推薦卡標示共同 TAG，並可前往探索頁。手機底部保留商店與收藏操作。
- `explore.html?tag=...`：依 TAG 探索所有已收錄的未來新作。支援中英文標籤搜尋、每個標籤的遊戲數量，以及名稱、關注度、收藏與排序的組合篩選。
- `saved.html`：此瀏覽器的收藏；使用 localStorage，不需登入，也不會修改 Steam 關注或願望清單。

所有清單都支援中英文名稱／AppID 搜尋、最低關注人數篩選與排序。首頁搜尋限定目前月份。手機預設清單檢視，仍可切回月曆。鍵盤 `/` 聚焦搜尋，Escape 清除搜尋。網址保留月份、檢視與篩選條件。清單以 36 筆分批呈現。

卡片整體連至遊戲詳細頁，愛心收藏與 Steam 商店連結可分別操作。語言支援以「支援繁中」「支援簡中」分別標示，保留英文、其他語言與待確認狀態。詳細頁返回時保留原清單的篩選條件。頁首動態開關跨頁同步，並尊重裝置的減少動態設定。首頁已移除大型主視覺、輪播、跑馬燈與三格統計。

## 日期與收錄條件

- 今日與日期區間都使用 Asia/Taipei（UTC+8）。後端提供的日期直接顯示，不任意加一天；精確時刻的換日由現有後端處理。
- 月曆、即將上市與指定日期頁只列明確發售日期且 Followers >= 5,000 的遊戲。
- 近期上市保留正式清單中至少 5,000 人關注的遊戲，以及嚴格超過 3,000 人關注且具 `tracked_release`／`direct_release` 來源的既有紀錄。只有直接上市且具有 `first_week_qualified_at` 的遊戲顯示「近期黑馬」。沒有遊戲時呈現空狀態，不以暢銷榜或虛構資料補齊。
- Followers 是 Steam Community 關注人數，並非願望清單數。

## 資料介面

- `data/catalog.json`：一般瀏覽只讀這份精簡清單，保留篩選、TAG、語言與圖片欄位。
- `data/games/APPID.json`：完整單款內容；詳細頁可先顯示這份資料，推薦清單另外載入。
- `data/steam_upcoming.json`：精簡清單無法讀取時的完整備援；再失敗才讀 `data/index.json` 與月份分片。
- `data/steam_preview.json`：僅在正式清單不可用或舊版格式時使用，避免舊快照覆蓋正式資料。
- `data/content_refresh_status.json`：內容對帳的待補欄位、失敗與重試時間；不代表所有 Steam 候選都已查完。
- `data/twitch_live.json`、`data/youtube_live.json`：既有直播資料，本次 UI 不新增直播頁。

前端只讀取公開靜態 JSON。排程、抓取、API 串接與所有資料檔案仍由後端專案負責。收錄尚未完成時，網站會顯示「新作持續收錄中」與更新時間，詳細說明收在「關於資料」。

跨頁共用 60 秒的 session 快取，使用固定網址搭配 HTTP 重新驗證。封面依 Steam 回傳的實際 1x／2x 資產載入，失敗時依序降級；清單圖片延遲載入。搜尋等待 120ms 並支援中文輸入法，排序與篩選重用卡片，避免反覆解碼圖片、重播進場動畫。使用裝置字體，手機減少大面積背景模糊。

TAG 僅使用已公開的欄位，不從類型推測。詳細頁推薦依共同 TAG 數量排序，再比較發售日距離及關注人數；沒有共同 TAG 才改依日期推薦並標明依據。指定 TAG 沒有其他遊戲時顯示空狀態。探索頁只列今日起的合格新作，標籤數量代表公開清單的涵蓋範圍。

## 維護

共用程式位於 `assets/radar-data-v1.js`、`assets/radar-storage-v2.js`、`assets/radar-artwork-v1.js`、`assets/radar-motion-v1.js`、`assets/radar-play-v2.js`、`assets/radar-play-v2.css`；詳細頁使用 `assets/radar-game-detail-v1.js` 與對應 CSS。`assets/radar-discovery-v1.js` 共用標籤翻譯、資料補充與推薦排序。原有舊版 UI/list/date 程式保留，但目前 HTML 已不載入。

```sh
python -m http.server 8000
node --test tests/*.test.cjs
```

`tests/responsive.html` 提供 320 / 390 / 768 / 1280px 版面檢視。設計與素材來源記錄在 [DESIGN.md](./DESIGN.md)。

資料流、修正結果與仍待改善的覆蓋問題記錄在 [2026-09-28 流程整理](docs/pipeline-optimization-20260928.md)。

## GitHub Pages

既有網站使用 main 分支根目錄：<https://danielet087.github.io/game-trend-radar/>。

若從新 repository 啟用，於 Settings → Pages 選 Deploy from a branch，指定 main 與 /(root)。
