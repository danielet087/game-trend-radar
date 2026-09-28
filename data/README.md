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
| `twitch_live.json`、`youtube_live.json` | 原有直播輸出；本輪未改動其排程或資料來源 |

派生檔必須與單款紀錄在同一次 commit 更新；只改個別月份或完整備援會導致頁面不一致。`catalog.json.revision` 是完整公開資料的內容指紋，筆數相同也可能需要更新。

`generated_at` 是資料檔產生時間；`follower_checked_at` 才是 Followers 查詢時間。補圖片或 TAG 不能把 Followers 標成剛查詢。`complete: true` 僅表示本次對帳的已接受主清單內容完整，不代表所有 Steam 候選都已完成官方查核。
