# Game Trend Radar

Steam 新作關注度與遊戲發售月曆（純靜態網站）。

## 首頁
- 月曆：每個發售日期最多兩個遊戲名稱標籤，依 Steam Followers 由高到低選取；其餘顯示 +N 款。點擊**日期格**進入 `date.html?date=YYYY-MM-DD` 查看當天全部符合門檻的遊戲（也可搜尋及排序）；點擊**遊戲名稱標籤**仍直接開啟 Steam 商店。返回月曆時會回到原本月份。
- 近期已上市：近 30 天經 Steam Store 確認已發售、Followers **嚴格大於 3,000** 的遊戲；包含原本 Upcoming 追蹤遊戲與直接上架的新作。直接上架遊戲在發售日到第 7 天內查得超過 3,000 Followers 時加入，標示「近期黑馬」，並保留至上市滿 30 天；首週未達門檻的遊戲不會在超過一週後才以黑馬加入。只依已查詢的 Followers 排序，不用 Steam 暢銷榜填補。
- 最近快要上市：未來 45 天內的遊戲，依發售日排序。
- 點選標籤或遊戲卡片可開啟 Steam 商店。
- 首頁「近期已上市／最近快要上市」各有「查看全部」連結，分別前往 `released.html` 與 `upcoming.html`。兩頁會列出其區間內全部符合條件的遊戲（不受首頁最多三款的限制），可搜尋名稱／AppID、依日期或 Followers 排序，並可返回月曆；近期黑馬標籤只顯示於經驗證的直接上市遊戲。

## 上市日期（台灣時間）
- 首頁月曆、近期上市、即將上市、指定日期清單均使用台灣時間（Asia/Taipei，UTC+8）判斷「今天」與日期區間。
- 私有後端 Steam 搜尋指定台灣區（`cc=TW`）。若 Steam 提供具有時區的精確發售時間（Unix timestamp 或 ISO datetime），轉換成台灣日期；若 Steam 只公告日期，維持台灣區商店列出的日期，不假設美西 10:00、不任意加一天。
- `generated_at` 仍使用 UTC ISO 時間戳作為資料紀錄，與遊戲上市日期的顯示時區不同。

## 公開資料
- `data/steam_preview.json`：初始化中的暫存預覽。私有後端從 steam-state checkpoint 中篩選 Followers >= 5000 的 AppID，補 Store 名稱、封面、精確發售日期；另外掃描 Steam New Releases，只公開已發售且 Followers > 3000 的近期遊戲，不會公開完整 checkpoint。
- `data/steam_upcoming.json`：Steam 初始化成功後正式發布的遊戲資料（優先使用）。
- `data/twitch_live.json`、`data/youtube_live.json`：直播平台資料，首頁尚未使用。

若未有公開的 Steam JSON，首頁會顯示等待資料提示，不會填入虛構遊戲名稱或上市日期。

## GitHub Pages 啟用
本 repository 的 `index.html` 位於根目錄。若尚未啟用 GitHub Pages，請進入 **Settings → Pages → Build and deployment**，選 **Deploy from a branch**，分支選 **main**，資料夾選 **/(root)**，按 **Save**。啟用後網站會位於 `https://danielet087.github.io/game-trend-radar/`（以 GitHub Pages 顯示的實際網址為準）。

沒有前端 API Key；資料整理在私有後端透過 GitHub Actions 完成，前端只讀取公開 JSON。
