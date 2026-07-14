# ARCHITECTURE — Tunable Piano

純前端、無 build。`index.html` 於 `<head>` 由 CDN 載入 Tone.js,`<body>` 末依序載入
`audio → keyboard → metronome → ui → main`。各模組為 IIFE,對外掛在 `window`
(`AudioEngine`/`Keyboard`/`Metronome`/`UI`)。

## DOM 結構(index.html)
`#unlock`(解鎖層) / `#rotate`(直向提示) / `#app`:
- `.controls` 主控制列(兩排):節拍器、A4 基準、琴鍵數、首調、和弦;各盒 `flex:1 0 auto` 撐滿列寬。
- `#menu-panel` 設定選單面板(絕對定位覆蓋控制列,不重排鍵盤):✕、音色、滑動換音域、八度、主題(含自訂三色 picker)。
  定位 `top/left/right: calc(env(safe-area-inset-*) + 6px)`(避瀏海,對齊鍵盤緣)。
- `.scroll-row`:卷軸(flex:1)+ `#menu-toggle` ⚙(不佔控制列寬)。
- `#keyboard`(`flex:1 1 auto; min-height:40%`,不得溢出畫面底部)。

## 啟動流程(main.js)
1. 解鎖層 + 橫向偵測(直向蓋 `#rotate`)。
2. 使用者手勢 → `unlock()`:
   - 手勢內同步 `Tone.start()`(不 await);設 iOS `audioSession='playback'`(靜音鍵也出聲)。
   - `AudioEngine.init()` → **先顯示 `#app`**(卷軸量測需版面尺寸)→ 依序 init 各 UI 模組
     (A4/Keyboard/Keys/Scrollbar/Octave/Transpose/Chord/Theme/Slide/Timbre/Menu/Metronome)
     → `loadAndApply()`(套 localStorage)→ `hookResume()`(切回恢復掛鉤)。
   - 整段 try/catch:任何失敗 `unlocked=false`,不留死畫面。
3. `UI.initTimbre()` 內啟動鋼琴取樣**背景載入**(不阻塞開場)。

## 模組職責與對外介面

### AudioEngine(audio.js)
- 音高:`midiToFreq(midi) = a4 × 2^((midi−69)/12)`;首調 `+transpose` 統一在 `noteOn` 套用。
- 訊號鏈:`PolySynth(triangle, −13dB)` 與 `Sampler(鋼琴, −6dB)` 並聯 → `Gain(1.0)` →
  `WaveShaper 軟削波(knee 0.7)` → Destination。節拍器 click 也接軟削波輸入。
- **雙音色**:`setTimbre('synth'|'piano')`;`loadPiano()` 背景抓 `audio/piano/` 24 檔 mp3
  → decodeAudioData 快取 `pianoBuffers`(AudioBuffer 與 context 無關,重建免重載)→ 建 Sampler。
  未就緒時 piano 自動退回合成音;`onPianoStatus(status, progress)` 供 UI 顯示進度。
- **noteOn/noteOff**:`active` map(freq → {count, inst})——同頻率只 attack 一次(引用計數,
  防 PolySynth release 配對歧義),release 回到「發聲當下的樂器」(中途切音色不漏收)。
- **靜音看門狗**:全部放開 2.5s 後(尾音已結束)重建 synth(dispose 必殺孤兒聲部;Sampler 不重建,
  補 releaseAll)。契約:最後放開 ≤2.5s 引擎必靜音。
- **切回恢復(核心,iOS)**:
  - `ensureRunning(fromGesture)`:running 且不髒 → 快樂路徑 return。
    手勢內:髒污/interrupted/連兩次未恢復 → `kickMediaSession()`(播 ~1s 無聲 `<audio>`
    重激活系統 session,1.5s 後卸載)→ `rebuildContext()`;失敗保留髒污。
    非手勢:僅有界 resume 重試(4 次),**絕不重建**(非手勢建的 context 是 suspended,無益且會連環重建)。
  - 髒污來源:①main.js 退背景 >8s;②`scheduleLivenessCheck`(state=running 但 currentTime
    500ms 未前進 = 殭屍)。
  - `rebuildContext()`:`Tone.setContext(new Tone.Context())` → 重建 synth/gain/shaper/sampler
    (復用 pianoBuffers)→ `onContextRebuild` 回呼(main.js 掛 `Metronome.rebuild()`)→ 關舊 context。
    A4/首調等狀態在閉包,自然保留。
  - **注意**:一律 `Tone.getContext()`;`Tone.context` 是過期綁定。
- API:`init, noteOn, noteOff, releaseAll, ensureRunning, markDirty, midiToFreq,
  setA4/getA4(415–445), setTranspose/getTranspose(±6), setTimbre/getTimbre, loadPiano,
  onPianoStatus(setter), onContextRebuild(setter), pianoStatus, softClip, config, output;
  測試探針 _synth/_sampler/_activeSize/_pianoBuffers/_forceDirty/_kickEl/_rebuildContext`。

### Keyboard(keyboard.js)
- 資料模型:A1(33)–C6(84)共 52 鍵(白 31);可視視窗 `visibleWhiteCount`(6–20)+ `startWhiteIndex`。
- 渲染:傳統鋼琴佈局(白鍵滿高等寬、黑鍵 ×0.62 疊交界),只渲染可視子集;重繪前先收掉按住音。
- 互動:`pointerdown` → `AudioEngine.noteOn`(+`.active` 視覺 + capture);全域 `pointerup/cancel`
  釋放;最後一指放開 → `releaseAll()`。
- **滑動換音域**:`setSlideMode(on)`;滑動模式下按住琴鍵水平拖曳,以白鍵寬為步距平移視窗
  (錨點制無漂移);此模式不 setPointerCapture(重繪會使 capture 失效),事件由 document 接手;
  視窗變動經 `onWindowChange` 通知 UI(同步卷軸/八度+persist)。
- 和弦模式:`chordMidis(root)` 依 `chordQuality`('diatonic'|maj/min/dim/maj7/dom7/min7/hdim7)疊音。
- API:`initKeyboard, setVisibleWhiteCount, setStartWhiteIndex, shiftOctave,
  setChordMode/isChordMode, setChordQuality/getChordQuality, setSlideMode/isSlideMode,
  onHeldChange(setter), onWindowChange(setter), MIN/MAX_WHITE, leftmostName, totalWhites,
  maxStartWhiteIndex, visibleWhiteCount, startWhiteIndex`。

### Metronome(metronome.js)
- `Tone.Loop((time)=>click…, beatNote).start(0)` + Transport(**非 setInterval 發聲**);
  視覺拍點 `Tone.getDraw().schedule(...,time)` 對齊 audio clock。
- **一律 `Tone.getTransport()/getDraw()`**(過期綁定陷阱,重建後舊參照會 crash)。
- `rebuild()`:context 重建後丟棄舊 click/loop,以現存 bpm/拍號/回呼重建;原在跑則接續跑。
- API:`init(onBeat), rebuild, start/stop/toggle/isRunning, setBpm/getBpm,
  setTimeSignature/getTimeSignature/cycleDenominator, tap(now?);測試探針 _onClick/_fireBeat`。

### UI(ui.js)
- 各控制 init + `refreshers[]`/`refreshAll()`;`persist()`(去抖 150ms)寫 localStorage
  `tunable-piano-v1`:{a4, transpose, theme, custom{kb,bg,accent}, timbre, slide, bpm, num, den,
  whiteCount, startWhite};`loadAndApply()` 開場套用。
- **設定選單**:`initMenu()`——⚙ 開/✕ 關 `#menu-panel`(hidden 切換)。
- **主題**:`applyTheme('classic'|'gray'|'pink'|'custom')`;自訂主題三色(鍵盤/背景/啟動)
  由 `deriveCustomVars` 依亮度衍生完整 `--c-*` 變數組(面板/按鈕/文字明暗/邊框/卷軸/拍點),
  白鍵維持純白;三色 picker 僅自訂主題時顯示。
- **音色**:`initTimbre()`——合成/鋼琴單選;鋼琴鈕顯示載入進度;解鎖後自動 `loadPiano()`。
- 和弦辨識:`recognizeChord(heldMidis)` 模板比對(含轉位),依實發音高(含首調)命名。
  注意:和弦品質綁定選擇器為 `.chord-quals .qual`(音色鈕共用 .qual 樣式,勿誤綁)。
- API:`initA4, initKeys, initScrollbar, initMetronome, initOctave, initTranspose,
  initChord, initTheme, initSlide, initTimbre, initMenu, loadAndApply`。

### main.js
- 解鎖流程(見上)。
- `hookResume()`:visibilitychange/focus/pageshow → `ensureRunning(false)`;
  `#app` pointerdown(capture)→ `ensureRunning(true)`;退背景計時(hidden 記時,回前景
  >8s → `AudioEngine.markDirty()`);`AudioEngine.onContextRebuild = Metronome.rebuild`。

## 資料流
- 按鍵 → Keyboard.onDown → (和弦模式算音組) → AudioEngine.noteOn(套首調、選樂器、引用計數) → 發聲 + heldAdd。
- heldAdd/Remove → onHeldChange → UI.recognizeChord → 和弦顯示。
- 滑動拖曳 → onSlideMove → setStartWhiteIndex → onWindowChange → UI 同步卷軸/八度 + persist。
- 控制列改值 → 引擎 setter + render + persist;開場 loadAndApply → setter 群 → refreshAll。
- 切回 app → visibilitychange(>8s 標髒)→ 第一次觸碰 → kick + rebuildContext → Metronome.rebuild。

## 驗證方式(重要)
- **headless 的即時 AnalyserNode 收不到音訊、rAF 在隱藏分頁暫停** → 音訊/頻率驗證一律用
  `Tone.Offline` 離線渲染 + 自相關/峰值分析;視覺拍點用測試探針確定性驗證。
- **iOS 殭屍/中斷狀態桌面做不出來** → 用 instance property shadow 偽造(state getter/currentTime
  getter/monkeypatch resume),驗證程式路徑;實效仍需實機。
- **本機開發快取陷阱**:`python3 -m http.server` 無 cache header,瀏覽器會供舊 JS(重載也不換),
  曾對舊檔誤測。對策:no-store 自訂 server 或換 origin(localhost↔127.0.0.1)。見 DEPLOYMENT。
