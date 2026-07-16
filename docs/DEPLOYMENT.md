# DEPLOYMENT — Tunable Piano

## 環境
- **Repo**:https://github.com/marimbacheng/tunable-piano(public)
- **分支**:`main`(唯一;無 PR 流程,直接 commit + push)
- **線上**:https://marimbacheng.github.io/tunable-piano/
- **CI/CD**:**無 GitHub Actions workflow**。使用 GitHub Pages 內建(legacy)建置,
  來源 = `main` 分支 / root(`/`)。push 到 main 即自動觸發重建。
- 認證:本機 `gh` CLI 已登入(帳號 marimbacheng)。**token 存於 gh 設定,勿寫入 repo 或文件。**

## 為何能跑在 Pages 子路徑
所有資產用相對路徑(`css/…`、`js/…`、`icons/…`、`manifest.json`);manifest `start_url:"."`。
**若改成絕對路徑(`/css/…`)會在 `username.github.io/tunable-piano/` 子路徑 404。**

## 部署流程
```bash
git add -A && git commit -m "…"     # 訊息末尾接 Co-Authored-By: Claude ...
git push origin main                 # 觸發 Pages 重建
```
建置約 1–2 分鐘。查狀態 / 確認上線:
```bash
# 建置狀態(building / built)
gh api /repos/marimbacheng/tunable-piano/pages/builds/latest --jq '.status'
# 確認「最新版」真的上線:抓線上檔案比對特徵字串(避免抓到上一版快取)
curl -s "https://marimbacheng.github.io/tunable-piano/js/audio.js?cb=$RANDOM" | grep -c "特徵字串"
```
> 慣例:每次部署後用 `curl + grep` 對線上檔案核對本次改動的特徵(某函式名、某色碼),
> 因為 push 後短時間內 CDN 可能仍供上一版。等特徵出現才算真的上線。

### Service Worker 更新紀律(關鍵,離線化後新增)
- **改任何被 precache 的資產(js/css/html/mp3/圖示/Tone.js)→ 必 bump `sw.js` 的 `CACHE` 版本號**
  (如 `tunable-piano-precache-v1` → `-v2`)。否則舊 SW 命中舊快取,使用者永遠看不到新版。
- 新增/刪除資產 → 同步改 `sw.js` 的 `ASSETS` 清單(`addAll` 原子:漏一個 404 → 整個 install 失敗)。
- 更新機制:`skipWaiting`+`clients.claim`,使用者下次連網載入即自動換新版、清舊 cache(autoUpdate)。
- 上線核對:除 `curl+grep` 特徵字串,另可在裝置 devtools → Application → Service Workers 看版本、
  Cache Storage 看 `tunable-piano-precache-vN` 是否為新號。

## 首次設定(已完成,僅備查)
```bash
gh repo create tunable-piano --public --source=. --remote=origin --push
gh api -X POST /repos/marimbacheng/tunable-piano/pages -f "source[branch]=main" -f "source[path]=/"
```

## 已踩過的坑
- **推送含二進位檔(音訊樣本)曾 HTTP 400**(`RPC failed; curl 56`):
  已在本機 repo 設 `git config http.postBuffer 52428800` 解決。新環境 clone 後若再遇到,重設一次即可。
- **本機開發快取陷阱(重要)**:`python3 -m http.server` 不送 cache header,瀏覽器可能一直供舊 JS
  (重新整理也不換),曾造成「對舊程式碼誤測」。對策擇一:
  ```bash
  # no-store 開發伺服器(專案根目錄執行)
  python3 -c "
  from http.server import HTTPServer, SimpleHTTPRequestHandler
  class H(SimpleHTTPRequestHandler):
      def end_headers(self):
          self.send_header('Cache-Control', 'no-store'); super().end_headers()
  HTTPServer(('127.0.0.1', 8000), H).serve_forever()"
  ```
  或換 origin 繞快取鍵:`localhost:8000` ↔ `127.0.0.1:8000` 是不同快取空間。
  線上 GitHub Pages 有正常 cache 頭,不受此陷阱影響(但仍要做特徵字串核對)。

## Rollback
無 Actions,回滾即回退 main 內容:
```bash
git revert <壞掉的 hash> && git push origin main      # 保留歷史(推薦)
# 或緊急:git reset --hard <好的 hash> && git push --force origin main(會改寫歷史,慎用)
```
push 後同樣等 Pages 重建 + curl 核對。

## 上線 / 實機注意事項
- **iOS 靜音鍵出聲**:僅靠 `audioSession='playback'`(2026-07-11 實機確認;無聲常駐 loop 已移除
  以消除鎖屏控制器——`playback` session 本身仍會留下無圖示的極簡控制器,屬一體兩面取捨,見 DECISIONS)。
- **切回 app 恢復音訊**:短背景=手勢內重建;長背景(>10-20s 殭屍)=髒污標記+無聲 `<audio>` kick
  (皆已實機確認)。恢復瞬間鎖屏可能短暫閃現媒體控制器(~1.5s),屬預期;
  恢復「會要等一下」屬可接受(使用者定案)。若實機再現無聲,先問:鎖屏有無閃過控制器?
  (有=kick 有跑、問題在後段;無=髒污標記沒觸發)。
- **A2HS 換名/換圖**:iOS 快取加入主畫面的名稱與圖示。改過之後,**要先刪舊捷徑再重新「加入主畫面」**才會更新。
- **節拍器拍點亮燈**:靠 `requestAnimationFrame`(Tone.Draw),背景/隱藏分頁會暫停 → 屬正常,回前景即恢復。
- **音訊解鎖**:首次進站要點「開始」(手勢內啟動 AudioContext),iOS 必須。
- **鋼琴取樣**:首次載入下載 audio/piano/ 24 檔(1.8MB);已由 `sw.js` precache,離線切鋼琴照樣發聲。
- **離線 PWA(已做)**:`sw.js` precache 全資源(含自帶 Tone.js + 24 mp3)。**首次一定要有網路**讓 SW 裝好;
  之後(加到主畫面或直接開)可完全離線、飛航模式可用。首次沒網 → 打不開。設定存 localStorage,離線保留。
- **離線就緒指示(解鎖層)**:`#sw-status` 顯示「離線準備中…」→「✓ 離線就緒(可飛航模式使用)」。
  為何加:precache 完成與否原本**完全隱形**,使用者只能猜,看到「未連接網際網路」也無從判斷是沒裝好還是壞了。
  看到綠字才可安心離線。TOTAL=37 需與 `sw.js` 的 `ASSETS` 筆數同步。
- **iOS 主畫面 App 與 Safari 可能各自獨立儲存(關鍵坑)**:只在 Safari 開過**不保證**主畫面 App 也裝好 SW。
  要離線用主畫面圖示 → **就要用主畫面圖示連網開一次**,等出現「✓ 離線就緒」再離線。
  舊捷徑(SW 上線前加入的)可能指向無 SW 的舊版 → 刪掉重加。
- 部署前本機自測:本機起站(注意上方快取陷阱)→ 桌機瀏覽器 + 手機同區網 IP 實測。
