# CLAUDE.md — Tunable Piano(輕薄索引)

> 每則訊息都會載入本檔,保持精簡。細節在 `docs/`,依需要再讀。

## 一句話
iPhone 橫幅網頁鋼琴,輔助練唱抓音:可調 A4 基準、首調移調、順階/指定品質和弦、和弦辨識、節拍器、多主題。乾淨合成音。

## 技術棧(寫死)
- Vanilla JS + Tone.js(CDN,v14.8.49)+ 純 CSS。**無框架、無 build step**。
- 目標:iOS Safari 15+(主)、桌機 Chrome/Safari(開發)。RWD、橫幅。
- 部署:GitHub Pages(靜態、HTTPS)。線上:https://marimbacheng.github.io/tunable-piano/

## 目錄結構
```
index.html          結構、解鎖層、橫向提示、A2HS meta、CDN 載入 Tone.js
manifest.json       PWA(加入主畫面 名稱=Tunable Piano)
icons/              程式產生的鋼琴 App 圖示(180/192/512)
css/style.css       全部樣式(含主題 CSS 變數)
js/audio.js         音高公式、PolySynth、noteOn/off、首調、防爆音軟削波
js/keyboard.js      A1–C6 資料模型、可視視窗、渲染、和弦模式、按住音追蹤
js/metronome.js     Tone.Transport 排程、BPM、拍號、tap
js/ui.js            全部控制列 UI + localStorage + 和弦辨識
js/main.js          手勢解鎖、橫向偵測、模組組裝
piano-app-task-book.md   原始需求(歷史參考;實作已大幅超出)
```

## 關鍵慣例(改動勿破壞)
- **等律音高**:`f = A4ref × 2^((midi−69)/12)`;改 A4/首調只平移,律制固定等律。
- **首調**:位移統一在 `AudioEngine.noteOn(midi)` 內套 `+transpose`,鍵盤/和弦都自動移調。
- **發聲綁 `pointerdown`**(非 click);`noteOn` 起音、`noteOff`/放開才 release(長按延音)。全域 `touch-action:none`。
- **解鎖同步執行**:手勢內觸發 `Tone.start()` 但**不 await**,立即建 UI + try/catch(避免卡解鎖畫面)。
- **防爆音**:全鏈末端 `WaveShaper` 軟削波;每聲部 `-13dB` headroom,和弦峰值 <knee(0.7)全線性。
- **防卡音**:最後一指放開 → `releaseAll()`;`visibilitychange/pagehide/blur` → 強制收音。
- **資產一律相對路徑**(`css/…`、`js/…`、`icons/…`),禁絕對路徑(Pages 子路徑會 404)。
- **主題**:CSS 變數 + `body.theme-*` class;白鍵維持白、執行中狀態各主題自訂色。
- localStorage key `tunable-piano-v1`;存 a4/transpose/theme/bpm/拍號/鍵數/視窗位置。

## 常用指令
```
python3 -m http.server 8000        # 本機起站(專案根目錄)
git push origin main               # 推送 → 自動觸發 Pages 重建
gh api /repos/marimbacheng/tunable-piano/pages/builds/latest --jq .status   # 查建置
```

## 延伸文件清單(何時讀哪份)
- **改架構 / 加模組 / 看資料流** → `docs/ARCHITECTURE.md`
- **想知道某設計為何這樣做、別重蹈落選方案** → `docs/DECISIONS.md`
- **部署、rollback、上線注意、iOS 實機事項** → `docs/DEPLOYMENT.md`
- **接手時看「做到哪、已知問題、待辦」** → `docs/STATE.md`(不在 repo,本機檔)
