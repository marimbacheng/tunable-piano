# NOTES.md — 決策記錄

> 每個定案一行、含理由;落選方案也記;推翻時更新該行。
> 權威需求見 `piano-app-task-book.md`,工作契約見 `CLAUDE.md`。

## M0 — 骨架 / 解鎖 / 橫向偵測
- 檔案範圍:M0 只建 `index.html` / `css/style.css` / `js/main.js` / `NOTES.md`;`audio/keyboard/metronome/ui.js` 留到各自里程碑再建。理由:避免一堆空殼檔,先跑通最簡骨架。
- 解鎖:`pointerdown` + `click` 雙綁 + `unlocked` 旗標防重入,只實際跑一次 `Tone.start()`。理由:pointerdown 低延遲為主,click 為桌機/後備。
- context 狀態查詢:用 `Tone.getContext().state`。理由:14.x 穩定 API。
- 橫向偵測:`matchMedia('(orientation: portrait)')` + `change` 為主;`orientationchange`/`resize` 為後備。理由:iOS matchMedia 較可靠。與解鎖狀態解耦。
- 疊層:`#rotate`(z-index 30)>`#unlock`(20)>`#app`。理由:任何時刻直向都要蓋提示,含解鎖前。
- Tone.js:CDN jsdelivr `tone@14.8.49`(已 curl 驗證 HTTP 200)。本地資產全走相對路徑。M6 離線再改自帶。
- git:專案於 M0 起 `git init`,每關一乾淨 commit。
