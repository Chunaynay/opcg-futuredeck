# OPCG 未來牌組構築器

正式站：https://opcg-futuredeck.netlify.app （Netlify 直接發佈 `site/` 資料夾，沒有建置步驟）

```
site/                     ← Netlify publish 目錄
├── index.html            ← 構築器本體（單檔 HTML，頂欄左上有版號）
├── cards.json            ← 卡片資料：由 GitHub Actions 每兩週自動產生（見下）
├── custom.json           ← 站長手動維護的未發售／自訂卡（同卡號覆蓋官方資料）
├── custom/               ← 自訂卡圖（454×635 JPEG）
├── _redirects            ← 卡圖代理：/twimg/ 繁中官網、/jpimg/ 日版官網、/cnimg/ 簡中 CDN
└── last-run.json         ← 最近一次抓取摘要（來源狀態、新增卡號、commit 訊息）；Claude 排程任務靠它判斷有沒有跑成功
scripts/fetch-cards.mjs   ← 三官網抓取＋合併腳本（Node 22，無相依套件）
scripts/test/             ← 離線測試：mock-fetch fixtures、jsdom 煙霧測試
.github/workflows/update-cards.yml ← 排程
```

## 卡片資料自動更新

- **排程**：每週日 13:00 UTC（台北 21:00）觸發，job 內以 2026-10-11 為第 0 週、只有偶數週執行 → 實際為**每兩週一次**（10/11、10/25、11/8…）。週一同一時間有一次**自動補跑**，只在前一天的排程沒有成功紀錄時才真的執行。
- **手動**：Actions → *Update card data* → *Run workflow*（不受雙週限制）。
- **來源與合併規則**：簡中官網（onepiece-cardgame.cn 的 windoent API）為主；簡中沒有的卡號補繁中官網（asia-tc.onepiece-cardgame.com），再補日版官網（www.onepiece-cardgame.com）。補進來的卡轉成簡中 API 的 raw 欄位格式並標 `lang: tw|jp`；簡中卡另帶 `cardNameTw`／`cardNameJp` 當搜尋別名。
- **保護**：任一來源連不上或數量異常 → 沿用上一版該來源的資料；合併後卡數比上一版少 10% 以上 → 不輸出（workflow 失敗、沿用舊檔）。
- **部署**：每次執行都 commit `site/last-run.json`（卡片有變動時連 `site/cards.json` 一起），Netlify（Git 連動）自動部署。Netlify Free 每次部署 15 點／每月 300 點，開發時多個改動請合併成一次 push；不想觸發部署的 commit 訊息加 `[skip netlify]`。
- **監看**：Claude 排程任務每偶數週週日／週一 22:27 讀 https://opcg-futuredeck.netlify.app/last-run.json 與 Netlify 部署狀態，推播摘要到手機／Email。

本機測試（不需網路）：

```bash
node --import ./scripts/test/mock-fetch.mjs scripts/fetch-cards.mjs --out /tmp/t/cards.json --prev scripts/test/fixtures/prev_cards.json --summary /tmp/t/last-run.json
FAIL_HOSTS=webadmin.windoent.com node --import ./scripts/test/mock-fetch.mjs scripts/fetch-cards.mjs --out /tmp/t2/cards.json --prev /tmp/t/cards.json
npm i jsdom && node scripts/test/smoke_test.js site/index.html && node scripts/test/smoke_v37.js site/index.html /tmp/t/cards.json
```
