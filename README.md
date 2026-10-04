# Game Trend Radar

Steam 新作關注度、發售月曆與個人收藏。純 HTML / CSS / JavaScript，GitHub Pages 可直接提供網站，不需前端建置或 API Key。

## 頁面與操作

- `index.html`：直接進入發售月曆，下方為即將上市精選與近期上市。月曆每天顯示關注度最高的兩款；可直接選月份，點日期查看完整清單，點遊戲開啟站內詳細頁。
- `upcoming.html`：未來 45 天的已收錄新作；一般 Steam 來源至少 5,000 人關注，有效 Twitch 新作來源另行收錄。
- `released.html`：近 30 天的已收錄遊戲；沿用正式清單與經驗證近期黑馬的既有條件。
- `date.html?date=YYYY-MM-DD`：指定日期的完整清單，前一天／後一天直接切換相鄰日（含空日期、跨月、跨年），沿用已載入資料與篩選／排序。網址及瀏覽器上一頁／下一頁同步，返回月曆時保留目前日期的月份。
- `game.html?appid=...`：遊戲主題配色、大圖放大、發售資訊卡、語言支援與收藏。主視覺與完整 TAG 清單都直接連至 `explore.html?tag=...`，保留原始 TAG 編碼；推薦卡依共同 TAG 自動排序。手機底部保留商店與收藏操作。
- `explore.html?tag=...`：依 TAG 探索所有已收錄的未來新作。支援中英文標籤搜尋、每個標籤的遊戲數量，以及名稱、關注度、收藏與排序的組合篩選。
- `saved.html`：此瀏覽器的收藏；使用 localStorage，不需登入，也不會修改 Steam 關注或願望清單。

所有清單都支援中英文名稱／AppID 搜尋、最低關注人數篩選與排序。首頁搜尋限定目前月份。手機預設清單檢視，仍可切回月曆。鍵盤 `/` 聚焦搜尋，Escape 清除搜尋。網址保留月份、檢視與篩選條件。清單以 36 筆分批呈現。

卡片整體連至遊戲詳細頁，愛心收藏與 Steam 商店連結可分別操作。語言支援以「支援繁中」「支援簡中」分別標示，保留英文、其他語言與待確認狀態。詳細頁返回時保留原清單的篩選條件。頁首動態開關跨頁同步，並尊重裝置的減少動態設定。首頁已移除大型主視覺、輪播、跑馬燈與三格統計。

Steam 與 Nintendo 收錄透過 IGDB 提供的 Steam 商品網址確認同一遊戲後，清單合併成一張卡片；名稱相同不作為合併依據。卡片與倒數只顯示各平台最早的確切發售日，平台個別日期保留於月曆與遊戲詳細頁，Steam Followers 與 IGDB hypes 分別顯示。舊的 Steam 或 IGDB 收藏都能對應合併後的卡片。卡片名稱與英文原名各限一行，滑鼠移上可看完整名稱；沒有英文副標時仍保留一行高度。語言標籤靠右，放在發售日期與關注人數上方分隔線之前；日期在分隔線下方靠左上對齊。卡片只顯示一個平台狀態標籤：多平台遊戲顯示「多平台」，單平台顯示 Steam、NS 或 NS2；有官方獨佔證據才顯示「NS 獨佔」或「NS2 獨佔」。Nintendo 日期優先採用已核實的台灣官方資料，詳細頁列出日期來源及台灣確認狀態；尚未核實者保留原始地區，不冒充台灣上市日。

遊戲詳情分別顯示 Steam、NS、NS2 的語言支援。Nintendo 語言取自該平台與版本的官方資料，並列出來源地區與查核時間；不沿用 Steam 語言，也不把中文遊戲名稱或翻譯介紹視為支援中文的證據。只有明確列出繁體或簡體中文才顯示對應標籤；僅列「中文」時保留字體待確認，未取得官方資料時顯示語言支援待確認。Nintendo 卡片依該 Nintendo 版本資料顯示，合併卡片的語言標籤保留 Steam 版本標示，各平台完整清單以詳情頁為準。

## Twitch 新作觀測（實驗）

`twitch.html` 從「遊戲探索」下拉清單進入。預設為「全部追蹤」，可切換「Twitch 熱門新作／Steam 近期上市」；同一遊戲同時符合兩個來源時只呈現一列。原有官方全新、日期推算與待確認篩選收在「判讀篩選」。支援 Steam 繁中名、英文名、Twitch 名稱及類別 ID 搜尋，以及觀眾數、開台數、中位數排序；網址可分享篩選狀態。展開遊戲可看各來源期限、Steam 補充資訊與延遲載入的逐時紀錄。未配對 Steam 遊戲另列待配對，已排除類別保留可展開的依據。

頁面只抓本站靜態 JSON，不使用 API Key、不呼叫 Twitch API，也不讀取 Steam 大型目錄。Twitch 熱門新作與 Steam 已上市未滿 30 天的遊戲為兩個獨立入列來源；Steam 入口不套用 7,000 人門檻，沒有 Steam 對應的其他平台 Twitch 新作仍保留。同一個 Twitch 類別只呈現一列、沿用 Twitch 圖片。`data/twitch_steam_mapping.json` 補充 Steam 繁中名稱、TAG、關注度、上市日期與商店連結；尚未配對的 Steam 近期上市項目顯示待配對，沒有假的零觀眾。

主欄位「篩選後中位數」僅採免費追隨者 > 1,000 且觀眾 ≥ 10 的頻道；追隨紀錄有效期 24 小時。Twitch 入口首次收錄的 7,000 人門檻採全體頻道計算。`data/twitch_tracking.json` 的 `tracking_sources` 保留各來源期限；任一來源有效便持續觀測。Steam 來源採該版本的台灣上市資訊，Twitch 日期推算與官方標記各自保存，不互相替代。前端合併本輪候選、`tracked_games` 與追蹤名單，按類別 ID 去重；歷史補回尚未更新的值標示上次觀測時間，排序置於本輪量測後，不新增歷史點。名單／對照讀取失敗會提示並保留上次可用資料。只顯示規則相符、完整且有合格樣本的中位數；追隨數尚未查齊時顯示待查台數，無樣本與舊資料顯示「—」，排序不混入舊的全體中位數。展開可核對來源期限、Steam 補充資料、排除台數及逐時紀錄。

官方標記、Twitch 原始發售日期的 14 天推算、IGDB 首次發售日期的 30 天推算各自呈現；各筆優先使用 `window_days`，其次採快照中該來源設定，未記錄天數的舊快照維持 14 天判讀，不重算歷史命中。已有有效 Steam 追蹤的遊戲，不因 IGDB 全球首發較早而停止收集。未知不改為否定、未入列不改為零、不以平均數冒充中位數；過期快照明確提示，日期推算不等於官方 NEW。

檢查：`node --test tests/twitch.test.cjs`。共用導覽保留原生 details/summary，頁面動畫遵守動態開關與裝置偏好。

## 日期與收錄條件

- 今日與日期區間都使用 Asia/Taipei（UTC+8）。後端提供的日期直接顯示，不任意加一天；精確時刻的換日由現有後端處理。
- 月曆、即將上市與指定日期頁只列明確發售日期，且符合既有 Followers 門檻或完整有效 Twitch 新作來源的遊戲。全部關注度預設不設下限，仍可自行選擇 5,000 以上。
- 近期上市保留正式清單中至少 5,000 人關注的遊戲，以及嚴格超過 3,000 人關注且具 `tracked_release`／`direct_release` 來源的既有紀錄。只有直接上市且具有 `first_week_qualified_at` 的遊戲顯示「近期黑馬」。沒有遊戲時呈現空狀態，不以暢銷榜或虛構資料補齊。
- Followers 是 Steam Community 關注人數，並非願望清單數。
- Twitch 新作反查 Steam 後，來源證據與真實 Followers 隨主清單保存；前端核對正式遊戲、成人篩選與台灣精確日期。缺少／無效證據不放寬門檻，未完成驗證不假裝已收錄。

## 資料介面

- `data/catalog.json`：一般瀏覽只讀這份精簡清單，保留篩選、TAG、語言與圖片欄位。
- `data/games/APPID.json`：完整單款內容；詳細頁可先顯示這份資料，推薦清單另外載入。
- `data/steam_upcoming.json`：精簡清單無法讀取時的完整備援；再失敗才讀 `data/index.json` 與月份分片。
- `data/steam_preview.json`：僅在正式清單不可用或舊版格式時使用，避免舊快照覆蓋正式資料。
- `data/content_refresh_status.json`：內容對帳的待補欄位、失敗與重試時間；不代表所有 Steam 候選都已查完。
- `data/twitch_live.json`：Twitch 新作觀測頁的公開快照；schema v2 支援中位數、官方觀測與獨立日期推算。舊版熱門取樣不進入任何遊戲清單，只顯示等待新版的狀態。
- `data/twitch_steam_mapping.json`：Steam／IGDB／Twitch ID 對照、Steam 補充資訊及待配對狀態，由後端一併發布。
- `data/twitch_steam_discovery.json`：正式 Twitch 新作反查的官方 Steam AppID 與待確認佇列；由 Steam 主後端消費，存在於佇列不代表內容已發布。
- `data/twitch_history/YYYY-MM-DD.json`：台灣日期的逐時紀錄，只在展開歷史時讀取截止快照最近 24 小時涵蓋的日期檔。
- `data/youtube_live.json`：既有 YouTube 直播資料。

前端只讀取公開靜態 JSON；API 收集由後端專案負責。`radar-insights.yml` 每小時第 17 分由同一 Cloudflare 控制器觸發，從已發布的 JSON 推導雷達動態與成長資料。收錄尚未完成時，網站會顯示「新作持續收錄中」與更新時間，詳細說明收在「關於資料」。

Twitch「查看逐時紀錄」使用原生 SVG 互動折線圖（`assets/radar-twitch-chart-v1.js`）：切換總觀眾、開台數及篩選中位數，以及最近 6／24 小時。滑鼠滑過、手機點選或拖動下方時間軸可查看時段值；時間軸也支援方向鍵、Home／End。時段與實際快照產生時間分開顯示，統一使用台灣時間。有效資料點依時間相連：連續時段使用實線，跨缺測區間使用虛線呈現前後變化。缺測、該次未入列、舊版或未完整的篩選中位數仍無數值，不補零、不產生推估資料點；選到這些時段時照常顯示缺測原因。只有一筆時顯示單一資料點。圖表在展開後才建立，不載入外部圖表套件，重新讀取快照時釋放舊圖表監聽。

跨頁共用 60 秒的 session 快取，使用固定網址搭配 HTTP 重新驗證。封面依 Steam 回傳的實際 1x／2x 資產載入，失敗時依序降級；清單圖片延遲載入。搜尋等待 120ms 並支援中文輸入法，排序與篩選重用卡片，避免反覆解碼圖片、重播進場動畫。使用裝置字體，手機減少大面積背景模糊。

TAG 僅使用已公開的欄位，不從類型推測。詳細頁推薦依共同 TAG 數量排序，再比較發售日距離及關注人數；沒有共同 TAG 才改依日期推薦並標明依據。點擊 TAG 直接進入探索頁，不在詳細頁切換推薦或捲動。探索頁只列今日起的合格新作，標籤數量代表公開清單的涵蓋範圍。

遊戲介紹只顯示帶有 `short_description_language=zh-TW` 的繁中內容。來源依序為 Steam 繁中、官方簡中轉繁中、對照原文的本站翻譯；本站翻譯有來源小標。缺少繁中時顯示「繁體中文遊戲介紹整理中」，不將英文誤當繁中。介紹語言與遊戲支援語言分開，翻譯不代表遊戲支援繁中。

2026-09-28 已補齊現有 105 款：82 款官方繁中、16 款簡中轉繁中、7 款本站翻譯。Followers、發售日、收錄條件與圖片保持原資料。

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

## 資料分析排程

`radar-insights.yml` 每小時第 17 分由既有 [Cloudflare 排程控制器](https://github.com/danielet087/game-trend-radar-twitch-backend/tree/main/scheduler/cloudflare) 透過 `workflow_dispatch` 觸發；原 GitHub `schedule` 已移除。`target_slot` 與 `trigger_source=cloudflare` 會出現在執行名稱，供核對來源與原定時段。必要的資料更新 push、手動入口與 concurrency 保留。

排程觀測只透過 [scheduler.html 的直接網址](https://danielet087.github.io/game-trend-radar/scheduler.html) 查看，首頁與導覽不提供入口。頁面以台灣時間顯示六項工作的時間軸、實際執行／429 中斷、下一批與完整待查遊戲、暫停原因，分別標示資料更新時間。`noindex,nofollow` 供搜尋引擎參考，頁面仍為公開網址。

`scripts/sync_scheduler_queue_status.py` 隨既有 `radar-insights.yml` 更新本站佇列備份，只讀取 Steam 後端已發布的 `data/scheduler_queue_status.json`，驗證動態總數、實際名單、Twitch 優先數與時間。來源無法取得或格式不符時保留有效備份及其原始時間；較舊來源不覆蓋較新備份。發布衝突後重新讀取遠端版本再同步，不增加 Cron，也不查詢 Steam。
