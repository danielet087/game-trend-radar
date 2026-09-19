# Game Trend Radar

Steam 新作關注度、發售月曆與個人收藏。純 HTML / CSS / JavaScript，GitHub Pages 可直接提供網站，不需前端建置或 API Key。

## 頁面與操作

- `index.html`：即將上市精選、發售月曆、近期上市。月曆每天顯示關注度最高的兩款；點日期查看完整清單，點遊戲開啟 Steam 商店。
- `upcoming.html`：未來 45 天、至少 5,000 人關注的新作。
- `released.html`：近 30 天、已確認發售且關注人數嚴格超過 3,000 的遊戲。
- `date.html?date=YYYY-MM-DD`：指定日期的完整清單，返回時保留月份。
- `saved.html`：此瀏覽器的收藏；使用 localStorage，不需登入，也不會修改 Steam 關注或願望清單。

所有清單都支援中英文名稱／AppID 搜尋、最低關注人數篩選與排序。首頁搜尋限定目前月份。手機預設清單檢視，仍可切回月曆。鍵盤 `/` 聚焦搜尋，Escape 清除搜尋。網址保留月份、檢視與篩選條件。清單以 36 筆分批呈現。

## 日期與收錄條件

- 今日與日期區間都使用 Asia/Taipei（UTC+8）。後端提供的日期直接顯示，不任意加一天；精確時刻的換日由現有後端處理。
- 月曆、即將上市與指定日期頁只列明確發售日期且 Followers >= 5,000 的遊戲。
- 近期上市保留既有 `tracked_release`／`direct_release` 驗證條件。只有直接上市且具有 `first_week_qualified_at` 的遊戲顯示「近期黑馬」。沒有遊戲時呈現空狀態，不以暢銷榜或虛構資料補齊。
- Followers 是 Steam Community 關注人數，並非願望清單數。

## 資料介面

- `data/steam_upcoming.json`：優先使用的正式清單。
- `data/steam_preview.json`：正式清單無法讀取時的備援；提供中文名稱、封面補充與 `recent_games`。
- `data/twitch_live.json`、`data/youtube_live.json`：既有直播資料，本次 UI 不新增直播頁。

前端只讀取公開靜態 JSON。排程、抓取、API 串接與所有資料檔案仍由後端專案負責。收錄尚未完成時，網站會顯示「新作持續收錄中」與更新時間，詳細說明收在「關於資料」。

## 維護

共用程式位於 `assets/radar-data-v1.js`、`assets/radar-ui-v1.js`、`assets/radar-ui-v1.css`。原有舊版 list/date 程式保留，但目前 HTML 已不載入。

```sh
python -m http.server 8000
node --test tests/data.test.cjs
```

`tests/responsive.html` 提供 320 / 390 / 768 / 1280px 版面檢視。設計與素材來源記錄在 [DESIGN.md](./DESIGN.md)。

## GitHub Pages

既有網站使用 main 分支根目錄：<https://danielet087.github.io/game-trend-radar/>。

若從新 repository 啟用，於 Settings → Pages 選 Deploy from a branch，指定 main 與 /(root)。
