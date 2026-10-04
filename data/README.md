# Public data

此資料夾只存放可公開的整理後 JSON，不存放抓取程式、API Key 或 Secret。

| 檔案 | 角色 |
|---|---|
| `games/{appid}.json` | 單款完整公開紀錄，由主後端資格資料與內容補充合併 |
| `catalog.json` | v3 精簡清單，供前端搜尋、排序、TAG、月曆使用 |
| `calendar/{YYYY-MM}.json` | 同一份資料的月份分片 |
| `index.json`、`lists/*.json` | 月份與近期／未來遊戲索引 |
| `steam_upcoming.json` | 完整舊格式備援，也保留已上市的歷史紀錄 |
| `content_refresh_status.json` | 內容補充的實際完成狀態、缺漏欄位與重試時間 |
| `steam_preview.json` | 舊版備援；不能當成目前正式收錄數或更新時間 |
| `nintendo_upcoming.json` | IGDB 原生主機公開清單，包含 NS／NS2／PS5；沿用既有檔名與 IGDB 身分 |
| `nintendo_master.json` | IGDB 候選與平台別資格紀錄；包含尚未符合公開條件的候選 |
| `nintendo_refresh_status.json` | IGDB 收集及發布回條，含真實候選、公開與待處理數、平台 ID、收集／發布時間 |
| `activity.json`、`insights-state.json` | 已接受 Steam／IGDB 新作及平台／日期異動；保留同一遊戲的首次加入與既有活動歷史 |
| `growth.json` | Steam Community 的實際 Followers 量測，不把 IGDB hypes 當成 Steam 成長 |
| `scheduler_queue_status.json` | Steam Followers 待查佇列；IGDB 主機收集不混入此佇列 |
| `twitch_live.json`、`youtube_live.json` | 原有直播輸出；本輪未改動其排程或資料來源 |

派生檔必須與單款紀錄在同一次 commit 更新；只改個別月份或完整備援會導致頁面不一致。`catalog.json.revision` 是完整公開資料的內容指紋，筆數相同也可能需要更新。

`generated_at` 是資料檔產生時間；`follower_checked_at` 才是 Followers 查詢時間。補圖片或 TAG 不能把 Followers 標成剛查詢。`complete: true` 僅表示本次對帳的已接受主清單內容完整，不代表所有 Steam 候選都已完成官方查核。

IGDB 原生主機資料由 `game-trend-radar-igdb-backend` 統一收集並發布，為相容既有前端、回條與歷史狀態，繼續使用 `nintendo_*.json` 和活動的 `source: "nintendo"`；此內部名稱不限制只有任天堂平台。各版本依 `platforms`／`releases`／`platform_language_support` 的 NS、NS2、PS5 分開辨識，公開台灣日期須有該原生平台的官方證據，未知語言保留 `null`，不同平台語言不能互相代填。Steam AppID 與 IGDB ID 使用不同命名空間；已核實的 Steam 商品對應才合併，同款不同日期仍是同一遊戲的不同發售事件。

IGDB 完整候選量大時，`nintendo_master.json` 使用含 SHA-256 與解壓大小的 `gzip-base64` 封裝，完整保留候選、原始資料、更新歷史與續查狀態。後端自動校驗及解碼，舊未壓縮資料亦可載入。前端只讀公開 `nintendo_upcoming.json` 與刷新回條，不解壓主資料。
