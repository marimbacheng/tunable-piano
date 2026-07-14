# CLAUDE.md — Tunable Piano（輕薄索引）

> 每則訊息都會載入本檔,保持精簡。細節在 `docs/`,依需要再讀。

## 一句話
iPhone 橫幅網頁鋼琴,輔助練唱抓音:可調 A4 基準、首調移調、順階/指定品質和弦、和弦辨識、節拍器、多主題(含自訂三色)、雙音色(合成音/鋼琴取樣)、滑動換音域。

## 技術棧(寫死)
- Vanilla JS + Tone.js(CDN,v14.8.49)+ 純 CSS。**無框架、無 build step**。
- 目標:iOS Safari 15+(主)、桌機 Chrome/Safari(開發)。RWD、橫幅。
- 部署:GitHub Pages(靜態、HTTPS)。線上:https://marimbacheng.github.io/tunable-piano/

## 目錄結構
```
index.html          結構(控制列/設定選單面板/卷軸列+⚙/鍵盤)、解鎖層、A2HS meta、CDN Tone.js
manifest.json       PWA(加入主畫面 名稱=Tunable Piano)
icons/              程式產生的鋼琴 App 圖示(180/192/512)
audio/piano/        Salamander 鋼琴取樣 24 檔 mp3(1.8MB,CC BY 3.0,LICENSE.txt)
css/style.css       全部樣式(主題 CSS 變數、自訂主題 --c-*、選單面板、卷軸列)
js/audio.js         音高公式、PolySynth/Sampler 雙音色、noteOn/off(引用計數)、首調、
                    防爆音軟削波、靜音看門狗、切回恢復(髒污標記/驗屍/session kick/重建)
js/keyboard.js      A1–C6 資料模型、可視視窗、渲染、和弦模式、按住音追蹤、滑動換音域
js/metronome.js     Tone.Transport 排程、BPM、拍號、tap、rebuild(context 重建後重生)
js/ui.js            控制列 UI + 設定選單 + 主題(含自訂衍生) + localStorage + 和弦辨識
js/main.js          手勢解鎖、橫向偵測、模組組裝、切回恢復掛鉤(hookResume/退背景計時)
piano-app-task-book.md   原始需求(歷史參考;實作已大幅超出)
NOTES.md            逐里程碑決策一行版 + 實測數據(頻率誤差、峰值等)
```

## 關鍵慣例(改動勿破壞)
- **等律音高**:`f = A4ref × 2^((midi−69)/12)`;改 A4/首調只平移,律制固定等律。
- **首調**:位移統一在 `AudioEngine.noteOn(midi)` 內套 `+transpose`,鍵盤/和弦都自動移調。
- **發聲綁 `pointerdown`**(非 click);`noteOn` 起音、放開才 release(長按延音)。全域 `touch-action:none`。
- **解鎖同步執行**:手勢內觸發 `Tone.start()` 但**不 await**,立即建 UI + try/catch。
- **Tone 過期綁定陷阱**:一律用 `Tone.getContext()/getTransport()/getDraw()`;
  `Tone.context/Transport/Draw` 在 setContext 後仍指舊物件(會無限重建/crash)。
- **切回恢復**:重建 context 只在手勢內做;殭屍(state 謊報 running)靠髒污標記+currentTime 驗屍
  +無聲 `<audio>` kick 重激活系統 session。細節見 ARCHITECTURE/DECISIONS。
- **防爆音**:全鏈末端 `WaveShaper` 軟削波;合成 −13dB/聲部、鋼琴 −6dB,和弦峰值 <knee(0.7)全線性。
- **防卡音**:同頻引用計數 + 最後一指放開 `releaseAll()` + 靜音看門狗(放開 2.5s 後重建 synth)。
- **資產一律相對路徑**(`css/…`、`audio/…`),禁絕對路徑(Pages 子路徑會 404)。
- **主題**:CSS 變數 + `body.theme-*`;白鍵維持白;`.on` 狀態須在主題區塊內重宣告(specificity)。
- **版面**:主列=節拍器/A4/琴鍵數/首調/和弦,⚙(卷軸列右端)開設定選單=音色/滑動/八度/主題;
  選單面板定位須加 `env(safe-area-inset-*)`(避瀏海);keyboard `min-height:40%` 不得溢出裁切。
- localStorage key `tunable-piano-v1`;存 a4/transpose/theme/custom{kb,bg,accent}/timbre/slide/bpm/拍號/鍵數/視窗位置。

## 常用指令
```
python3 -m http.server 8000        # 本機起站(注意瀏覽器快取陷阱,見 DEPLOYMENT)
git push origin main               # 推送 → 自動觸發 Pages 重建
gh api /repos/marimbacheng/tunable-piano/pages/builds/latest --jq .status   # 查建置
```

## 延伸文件清單(何時讀哪份)
- **改架構 / 加模組 / 看資料流 / 音訊恢復機制** → `docs/ARCHITECTURE.md`
- **想知道某設計為何這樣做、別重蹈落選方案** → `docs/DECISIONS.md`
- **量測數據(頻率誤差、headroom 峰值、殭屍驗證矩陣)** → `NOTES.md`
- **部署、rollback、上線注意、iOS 實機事項、本機快取陷阱** → `docs/DEPLOYMENT.md`
- **接手時看「做到哪、已知問題、待辦」** → `docs/STATE.md`(不在 repo,本機檔)
