# 前端架構與維護

前端採用 Vue 3、TypeScript 與 Vite 多頁建置。既有 HTML 網址、query parameters、GitHub Pages 的 main/root 發布設定及 data/** 路徑保持相容。

## 原始碼與發布檔

| 位置 | 職責 |
|---|---|
| src/pages/*.html、entries/*.ts | 13 個頁面入口與內容骨架；樣式由入口 import |
| src/app | 頁面初始化與過渡 API 邊界 |
| src/domain | 身分、日期、平台、語言、多人、版本、發售證據、合併與契約型別 |
| src/data | 公開 JSON 轉接、執行時驗證、快取、來源狀態與詳情發布權威 |
| src/features | 清單、月曆、TAG、詳情、成長、比較、Twitch、排程 |
| src/shared | Vue 導覽與頁尾、收藏／動態狀態、圖片備援及共用互動 |
| 根目錄 HTML、assets/app | 由建置產生的靜態發布檔，供目前 main/root Pages 直接服務 |
| assets/radar-*.js、舊 CSS | 凍結的相容性與測試基準；新頁面不載入這些腳本 |

頁面組合功能，功能透過資料入口取得公開資料。規則使用明確 ESM imports；新 Vue 元件負責共用導覽、頁尾、遊戲卡及推薦卡。既有可操作的 SVG 圖表與部分原生 DOM 呈現保留在具備生命週期的功能模組中。原生控制器的少量 Radar* API 相容性由 bootstrap 集中初始化，新增功能應直接 import。

## 資料與狀態

- GameEntity、PlatformVersion、ReleaseEvent 分別描述遊戲、原生平台版本與發售事件；同款跨平台可以有不同發售日期與語言。
- 原公開 JSON 格式由來源轉接層處理。LegacyGame／LegacyDataset 是保留既有畫面行為的呈現模型。
- Steam Followers、IGDB hypes 與 Twitch 量測各自保留來源及查核時間，不互相換算。
- date-only 保留原日；時間戳依已發布的日期政策驗證。台灣時區不等於台灣官方上市確認，缺值不補零或虛構時刻。
- storage Result 區分 fresh、cached、stale、unavailable、invalid，保留來源、查核版本及原發布時間；快取60秒、請求去重、超時與備援集中管理。
- 部分單款紀錄尚未提供 revision。詳情合併時以已讀取的 catalog 為收錄與欄位權威，單款舊紀錄僅補允許的詳情欄位；不能以 generated_at 相同假定所有檔案同版。
- 簡介文字、語言、來源及原文網址由 descriptions.mjs 一起選取，跨平台共用 Steam 官方繁中 → Steam 官方簡中轉繁 → 其他官方中文 → 既有人工 editorial → Steam 英文 → IGDB 英文的順序。尚無中文時直接顯示英文，不自動翻譯；舊快照的 steam_machine_zh_tw／igdb_machine_zh_tw 不採用其中文，改讀已保存的 short_description_en。enrich 不會以英文覆蓋官方或人工中文；catalog 已提供簡介欄位時，不混入單款檔的舊來源標記。簡介語言不推定遊戲語言支援。
- FilterState 管理篩選，URL 保存可分享的月份、日期、TAG、搜尋與排序。收藏與動態偏好沿用既有 localStorage keys，保留 IGDB／Steam aliases 與跨分頁同步。
- 主 CSS 按原規則順序拆分為17個樣式模組；頁面樣式存放於對應 features。修改時注意 cascade、focus 及 reduced motion。

## 開發與驗證

需要 Node.js 24。首次執行 npm ci；npm run dev 開啟 /game-trend-radar/ 子路徑。開發伺服器直接提供原 data/**，不會呼叫平台 API。

```bash
npm ci
npm run build
npm run publish:static
npm test
npm run test:frontend
npx playwright install chromium
npm run test:browser
```

build 執行型別檢查後產生 dist。publish:static 僅同步13個根目錄 HTML、assets/app 及 .nojekyll，不複製或覆寫根目錄 data；保留最近兩版 hashed assets 供已開啟頁面載入。將 source 及 generated files 一併提交。

frontend-build.yml 對原始碼變更執行建置、來源規則與瀏覽器測試；PR檢查生成檔一致，main原始碼變更可自動提交新發布檔。資料收集器直接更新 data/** 時沿用目前 Pages 發布，不必重新編譯前端；既有 radar-insights 的 Pages rebuild 請求保持有效。

測試同時保留原行為基準，直接對新的來源規則、FilterState、收藏狀態、storage 與詳情合併執行測試，並透過 built preview 檢查真實頁面。變更資料資格與日期政策需要更新對應來源規則測試；修改元件需要檢查手機布局、鍵盤操作與舊網址。

## Twitch 語言區域

目前觀測與歷史子頁預設中文區，可切換全球；`region=global` 保存在網址及往返連結中。`audience-region.js` 在完成收錄與身分解析後投影顯示指標，因此中文排序不改變全球收錄資格。逐時曲線、統計與退潮分析使用同一區域；CSV 註明語言區域，中文匯出檔名含 `-zh`。

中文資料取自 `audience_regions.zh`；未收集的舊紀錄維持 null 並標示，不採全球數值補位。完整 census 的中文 0 人／0 台則保留為有效量測。歷史資料庫的最高觀眾與樣本數同樣使用所選區域，未知不借用全球高峰。

