# Game Trend Radar

Steam 新作關注度與遊戲發售月曆（純靜態網站）。

## 首頁
- 月曆：每個發售日期最多兩個遊戲名稱標籤，依 Steam Followers 由高到低選取；其餘顯示 +N 款。
- 近期已上市：近 30 天已上市的追蹤遊戲，補充 Steam Store 暢銷榜／新品資訊；不把暢銷榜排名誤寫成 Followers。
- 最近快要上市：未來 45 天內的遊戲，依發售日排序。
- 點選標籤或遊戲卡片可開啟 Steam 商店。

## 公開資料
- `data/steam_preview.json`：初始化中的暫存預覽。私有後端從 steam-state checkpoint 中篩選 Followers >= 5000 的 AppID，補 Store 名稱、封面、精確發售日期後才發布；不會公開 Followers < 5000 的完整 checkpoint。
- `data/steam_upcoming.json`：Steam 初始化成功後正式發布的遊戲資料（優先使用）。
- `data/twitch_live.json`、`data/youtube_live.json`：直播平台資料，首頁尚未使用。

若未有公開的 Steam JSON，首頁會顯示等待資料提示，不會填入虛構遊戲名稱或上市日期。

## GitHub Pages 啟用
本 repository 的 `index.html` 位於根目錄。若尚未啟用 GitHub Pages，請進入 **Settings → Pages → Build and deployment**，選 **Deploy from a branch**，分支選 **main**，資料夾選 **/(root)**，按 **Save**。啟用後網站會位於 `https://danielet087.github.io/game-trend-radar/`（以 GitHub Pages 顯示的實際網址為準）。

沒有前端 API Key；資料整理在私有後端透過 GitHub Actions 完成，前端只讀取公開 JSON。
