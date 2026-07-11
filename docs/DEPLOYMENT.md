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

## 首次設定(已完成,僅備查)
```bash
gh repo create tunable-piano --public --source=. --remote=origin --push
gh api -X POST /repos/marimbacheng/tunable-piano/pages -f "source[branch]=main" -f "source[path]=/"
```

## Rollback
無 Actions,回滾即回退 main 內容:
```bash
git revert <壞掉的 hash> && git push origin main      # 保留歷史(推薦)
# 或緊急:git reset --hard <好的 hash> && git push --force origin main(會改寫歷史,慎用)
```
push 後同樣等 Pages 重建 + curl 核對。

## 上線 / 實機注意事項
- **iOS 靜音鍵出聲**:靠 `audioSession='playback'` + 無聲 audio loop(見 DECISIONS)。
  **此行為只能在實機驗證**;若靜音後仍無聲,回報 iOS 版本再換 session 觸發時機。
- **A2HS 換名/換圖**:iOS 快取加入主畫面的名稱與圖示。改過之後,**要先刪舊捷徑再重新「加入主畫面」**才會更新。
- **節拍器拍點亮燈**:靠 `requestAnimationFrame`(Tone.Draw),背景/隱藏分頁會暫停 → 屬正常,回前景即恢復。
- **音訊解鎖**:首次進站要點「開始」(手勢內啟動 AudioContext),iOS 必須。
- **離線**:目前 Tone.js 走 CDN,**飛航模式不可用**(完整離線 PWA 未做,見 STATE 待辦)。
- 部署前本機自測:`python3 -m http.server 8000` → 桌機瀏覽器 + 手機同區網 IP 實測。
