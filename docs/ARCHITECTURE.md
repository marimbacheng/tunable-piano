# ARCHITECTURE — Tunable Piano

純前端、無 build。`index.html` 於 `<head>` 由 CDN 載入 Tone.js,`<body>` 末依序載入
`audio → keyboard → metronome → ui → main`。各模組為 IIFE,對外掛在 `window`
(`AudioEngine`/`Keyboard`/`Metronome`/`UI`)。

## 啟動流程(main.js)
1. 開場顯示解鎖層(`#unlock`)+ 橫向偵測(直向蓋 `#rotate` 提示)。
2. 使用者手勢(`pointerdown`/`click` 於解鎖鈕)→ `unlock()`:
   - 手勢內同步 `Tone.start()`(不 await);設 iOS `audioSession='playback'` + 無聲 audio loop(靜音也出聲)。
   - `AudioEngine.init()` → **先顯示 `#app`**(讓容器有版面尺寸,卷軸量測才正確)→
     依序 `UI.initA4 / Keyboard.initKeyboard / UI.initKeys / initScrollbar / initOctave /
     initTranspose / initChord / initTheme / initMetronome / loadAndApply`。
   - 整段 try/catch:任何失敗 `unlocked=false` 並讓錯誤浮現,不留死畫面。

## 模組職責與對外介面

### AudioEngine(audio.js)
- 音高:`midiToFreq(midi) = a4 × 2^((midi−69)/12)`。
- 訊號鏈:`PolySynth(triangle, −13dB) → Gain(1.0) → WaveShaper(軟削波) → Destination`。
  - 軟削波 `softClip`:|x|≤0.7 線性、之上 tanh 飽和,輸出必有界(防爆音安全網)。
  - 節拍器 click **接同一 `output`(軟削波輸入)**,共用防爆但獨立於主音量。
- 包絡:`attack .01 / decay .15 / sustain .8 / release 1.8`。
- **長按延音**:`noteOn(midi)→freq`(triggerAttack,套首調 `+transpose`)、`noteOff(freq)`(triggerRelease)、`releaseAll()`(防卡音兜底)。
- API:`init, noteOn, noteOff, releaseAll, midiToFreq, setA4/getA4(415–445),
  setTranspose/getTranspose(±6), softClip, config(getter), output(getter)`。

### Keyboard(keyboard.js)
- 資料模型:A1(33)–C6(84)共 52 鍵(白 31);每鍵 `{midi,pc,isWhite,octave,name,label}`。
- 渲染:傳統鋼琴佈局(白鍵滿高等寬並排、黑鍵 ×0.62 疊交界上方),只渲染可視視窗子集。
- 可視視窗:`visibleWhiteCount`(6–20)+ `startWhiteIndex`;`shiftOctave(±1)`=移 7 白鍵。
- 互動:`onDown` 綁 `pointerdown` → `AudioEngine.noteOn`(可多音)+ `.active` 視覺 + `setPointerCapture`;
  放開(全域 `pointerup/cancel`)→ `noteOff` + 復原。**最後一指放開呼叫 `releaseAll()`**。
- 和弦模式:`chordMidis(root)` 依 `chordQuality`('diatonic' 或 QUALITIES:maj/min/dim/maj7/dom7/min7/hdim7)
  疊音;順階用 `DIATONIC`(C4=do 音階級數)。
- 按住音追蹤:`held` 計數 map + `onHeldChange(sortedMidis[])` 回呼 → 供 UI 和弦辨識。
- 防卡音:`releaseAllPressed()`(切離頁面/失焦時)。
- API:`initKeyboard, setVisibleWhiteCount, setStartWhiteIndex, shiftOctave,
  setChordMode/isChordMode, setChordQuality/getChordQuality, onHeldChange(setter),
  MIN/MAX_WHITE, leftmostName, totalWhites, maxStartWhiteIndex, visibleWhiteCount, startWhiteIndex`。

### Metronome(metronome.js)
- `Tone.Loop((time)=>click…, beatNote).start(0)` + `Tone.Transport`(**非 setInterval 發聲**)。
- 視覺拍點用 `Tone.Draw.schedule(...,time)` 對齊 audio clock。
- BPM 20–400;拍號 numerator 1–12 / denominator {2,4,8};tap 取最近 2 下、>3s 重置。
- click 用獨立 `Tone.Synth`(square 短包絡),接 `AudioEngine.output`。
- API:`init(onBeat), start/stop/toggle/isRunning, setBpm/getBpm,
  setTimeSignature/getTimeSignature/cycleDenominator, tap(now?)`。

### UI(ui.js)
- 建各控制列並綁定,`refreshers[]` + `refreshAll()` 供載入設定後統一刷新顯示。
- 視窗連動:`refreshWindow()` 同步卷軸拇指(`syncScroll`)+ 八度顯示(`syncOctave`)。
- 卷軸:拖曳時拇指連續跟手(不量化)、放手才吸附;中央圓點提示可滑。
- 和弦辨識:`recognizeChord(heldMidis)` — 取唯一 pc 依實際音高當根音候選,相對半音集合比對
  `CHORD_TEMPLATES`(含 aug/dim7),依**實發音高(含首調)**命名,顯示 C/Cm/CM7/Dø7…。
- 主題:`applyTheme('classic'|'gray'|'pink')` 加 `body.theme-*` class。
- 狀態保存:`persist()`(去抖 150ms)寫 localStorage;`loadAndApply()` 開場套用。
- API:`initA4, initKeys, initScrollbar, initMetronome, initOctave, initTranspose,
  initChord, initTheme, loadAndApply`。

## 資料流
- 按鍵 → Keyboard.onDown → (和弦模式算音組) → AudioEngine.noteOn(每音套首調) → 發聲 + heldAdd。
- heldAdd/Remove → Keyboard.onHeldChange → UI.recognizeChord → 更新和弦顯示。
- 控制列改值 → 對應引擎 setter + render + `persist()`;視窗類另呼 `refreshWindow()`。
- 開場 `loadAndApply()`:localStorage → 各引擎 setter → `refreshAll()`。

## 驗證方式(重要)
- **headless 瀏覽器的即時 `AnalyserNode` 收不到音訊、`Tone.Draw`(rAF)在隱藏分頁暫停** →
  音訊/頻率驗證一律用 `Tone.Offline` 離線渲染 + 自相關/峰值分析;視覺拍點/亮燈邏輯用測試探針
  (`Metronome._onClick/_fireBeat`)確定性驗證。詳見 DECISIONS。
