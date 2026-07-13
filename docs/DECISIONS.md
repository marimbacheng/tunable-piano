# DECISIONS — Tunable Piano

重要技術決策。格式:**決策 / 為何 / 落選方案**。細節在對應 commit(本專案無 PR,全部直接進 `main`)。
commit 連結:`https://github.com/marimbacheng/tunable-piano/commit/<hash>`。

> NOTES.md 另有逐里程碑的實測數據(頻率誤差、峰值等),可對照。

## 音訊

- **防爆音用 WaveShaper 軟削波,不用 Tone.Limiter** — `3c98c05`
  為何:`Tone.Limiter`(DynamicsCompressor)有 attack、擋不住起音瞬態,實測 6 鍵峰值仍達 2.73(爆音)。
  WaveShaperNode 會先把輸入鉗到 [-1,1] 再查表,輸出**數學上必有界**,任意鍵數不硬爆。
  落選:Tone.Limiter、單純降 gain(單音太小聲)。

- **音訊驗證用 `Tone.Offline` 離線渲染,不用即時 AnalyserNode** — `3c98c05`
  為何:headless 預覽的即時 AnalyserNode 收到全 0(連獨立 synth 也是),無音訊 render thread。
  離線渲染可確定性取樣 buffer,以自相關 + 拋物線內插測基頻(誤差 <0.1Hz)。

- **破音修正:每聲部 −13dB headroom** — `7836bc1`(-12)→ `68789c9`(-13)
  為何:破音感來自聲部過熱推進軟削波 tanh 飽和區。降到 −13dB 後 3/4 音和弦峰值 0.571/0.680
  皆 < knee(0.7)**全線性**,音色乾淨;音量損失交由裝置硬體音量鍵補償。
  落選:提高 knee(整體更早飽和)。

- **長按延音:`noteOn/noteOff` 取代固定 `triggerAttackRelease`** — `7836bc1`
  為何:需求改為「按住持續、放開才收」。release 用 `noteOn` 回傳的實際 freq 配對,
  避免 A4/首調中途變動導致 release 配錯而卡音。

- **主音量固定 1.0、移除拉桿** — `7836bc1`
  為何:使用者要求音量交給 iPhone 硬體音量鍵。保留 masterGain 節點(=1.0)使量測鏈一致。

- **首調位移統一在 `AudioEngine.noteOn` 內套用** — `7836bc1`
  為何:單一施力點,鍵盤點按與和弦疊音都自動移調(D 大調按 C 鍵=發 D 且和弦=DF#A 自動成立)。

- **卡長音對策：同頻引用計數 + 靜音看門狗（重建 synth）** — `10d2860`
  為何:卡長音(琴鍵未變色)= releaseAll 也收不掉的孤兒聲部,根因是 Tone.PolySynth
  聲部追蹤遺失(同音快速重觸發,CDN 庫改不了)。①同頻率只 attack 一次(引用計數),消除
  和弦重疊音的配對歧義與相位疊加;②全部放開 2.5s 後(尾音 1.8s 已結束)重建 synth,
  dispose 必殺孤兒聲部,聽感無感 —— 契約:最後放開 ≤2.5s 引擎必靜音。
  落選:再呼叫 releaseAll(孤兒聲部已脫離追蹤,無效)。

- **音色切換:合成音(預設)/鋼琴取樣,背景載入** — `0baedec`
  為何:Salamander(CC BY 3.0)每小三度 24 檔 mp3(1.8MB)自帶於 audio/piano/,不依賴外部 CDN。
  合成音即開即用;鋼琴解鎖後背景載入、鈕顯進度,未就緒先發合成音。active map 記錄發聲樂器,
  中途切音色仍正確收音;context 重建復用 AudioBuffer(與 context 無關)零重下載。
  A4 重調為取樣精確變速(440→432 實測 -31.9 音分,理論 -32.0);取樣固有 +6 音分屬真鋼琴非諧性。
  落選:引用 tonejs.github.io 線上音源(外部依賴)、全音階取樣(體積)。

- **鋼琴音量 -6dB、無低頻高通(最終定案)** — `e8694c6`(歷程 `d114291` 加 85Hz 高通+-9dB → 撤回)
  為何:「破破感」曾疑鏈路過載,離線量測否決(密集彈奏 -6dB 峰值 0.517 全線性),
  一度加 85Hz 高通 + 降 -9dB 防裝置端過載;後實機確認破音為**個別硬體問題**,
  且高通使低音太小聲(55Hz 基頻 ~-8dB)→ 使用者定案:移除高通、退回 -6dB。
  教訓:裝置端聽感問題先隔離硬體變因再動訊號鏈。

## 鍵盤 / 和弦

- **滑動換音域:「滑動」toggle(預設關),按住琴鍵水平拖曳平移視窗** — `10d2860`
  為何:錨點制(以按下點為基準,無漂移)、以白鍵寬為步距;平移觸發的 render 會先收掉
  按住音(既有防殘響邏輯),故滑動即自然停音。滑動模式不 setPointerCapture
  (重繪移除原鍵元素會使 capture 失效),事件由 document 層接手。2026-07 實機確認。

- **傳統鋼琴外觀(白鍵滿高、黑鍵較窄疊上),非等寬半音直條** — `983da4f`
  為何:使用者明確指定。連帶定義「可視鍵數 = 白鍵數」、黑鍵寬 ×0.62。

- **和弦品質單選列,取代「按住強制大」鈕** — `68789c9`
  為何:按住鈕只能出大三和弦且需雙手;單選列(順階/M/m/dim/M7/7/m7/ø7)通用、單手、可連彈。

- **和弦辨識:模板比對 + 依實發音高命名** — `68789c9`
  為何:同一顯示器要同時服務「和弦模式自動彈」與「手動按多音」。取唯一 pc 逐一當根音候選,
  相對半音集合比對模板 → 認得轉位;命名用實發音高(含首調),故 +2 按 CEG 顯示 D。

- **八度切換 = 移動 7 個白鍵(shiftOctave)** — `08399c8`
  為何:簡單可預期。頂端因視窗鍵數放不下更高八度的 C 而鉗制(顯示到 C6 止),屬視窗大小的固有限制。

- **移除 Drone 功能** — `08399c8`
  為何:使用者要求整包移除(引擎方法、長按邏輯、按鈕、視覺、CSS)。鍵盤回到單純點按/長按發聲。

## 解鎖 / iOS

- **解鎖同步執行、不 await `Tone.start()`** — `271ba1e`
  為何:原本整個 UI gate 在 `await Tone.start()`,該 promise 未解析或任一 init 拋錯就停在解鎖畫面
  (「按鈕閃一下沒反應」)。改同步觸發 resume(仍在手勢內)+ 立即建 UI + try/catch。
  註:preview harness 在隱藏分頁不派送座標點擊,原始失敗無法在該環境重現,修法針對最可能成因。

- **iOS 靜音模式出聲:僅靠 `navigator.audioSession.type='playback'`(iOS 16.4+)** — `82d9d86` → 後移除 loop `4e64759`
  為何:預設 WebAudio 走 ambient session(靜音鍵會靜音)。手勢內設 `audioSession.type='playback'` 即無視靜音鍵。
  **2026-07-11 實機確認:單靠 audioSession 即可靜音出聲**,原 `82d9d86` 的無聲 wav `<audio>` 後備已於 `4e64759` 移除(見下則)。

- **移除無聲 `<audio>` loop 以消除鎖屏 Now Playing;保留靜音出聲、接受最小控制器** — `4e64759`
  為何:持續播放的 `HTMLAudioElement` 會讓 iOS 顯示鎖屏/控制中心的「大圖示媒體卡片」。移除後大卡片消失。
  但**在 iOS 上「靜音出聲」與「Now Playing 控制器」是 `playback` session 的一體兩面**:能無視靜音鍵的類別(`playback`)必被列為 Now Playing;會避開控制器的類別(`ambient`/`transient`)都會尊重靜音鍵而沒聲。
  故無法兼得。移除 `<audio>` 已把控制器壓到「無圖示、僅顯示網址」的最小形態(2026-07-11 實機確認)。
  **決策:優先保留靜音出聲,接受這個最小控制器。** 落選:①拿掉 `audioSession='playback'`(控制器全消但靜音下沒聲);②動態切換 session(複雜、首音易在靜音下漏聲)。

- **防卡音雙層保險** — `82d9d86`
  為何:偶發卡音來自 (a) iOS 放開事件遺失、(b) PolySynth 同音重疊 release 配對失敗。
  ①最後一指放開 → `releaseAll()`(此刻不應有持續音);②`visibilitychange(hidden)/pagehide/blur`
  → `releaseAllPressed()` 強制收音 + 清視覺 + 清 held。

- **切回 app 恢復音訊:手勢內重建 AudioContext,非手勢僅有界 resume** — `bade9b0`(前導嘗試 `10d2860`)
  為何:移除無聲 loop 後,切回時無媒體元素重新激活音訊 session,playback session 下
  interrupted 的 context 光靠 resume() 實機救不回(**2026-07-13 實機確認修復有效**)。
  手勢內遇 interrupted → 立即整組重建(手勢內新建 context 必 running = 重新激活 session,
  亦治殭屍 context);suspended 連兩次手勢未恢復也重建;非手勢只做 4 次 resume 重試、
  **絕不重建**(非手勢建的 context 是 suspended,無益且實測有連環重建風險)。
  重建保留 A4/首調/BPM/拍號,節拍器接續跑。
  落選:①單靠 resume(第一輪修法,實機無效);②加回無聲 loop(鎖屏控制器回歸);
  ③非手勢也重建(連環重建)。
  **陷阱(重要)**:`Tone.context`/`Tone.Transport`/`Tone.Draw` 是模組匯出的過期綁定,
  setContext 後仍指舊物件(前者致無限重建、後兩者致節拍器 crash)——
  一律用 `Tone.getContext()/getTransport()/getDraw()`。

- **殭屍音訊(長背景 >10–20s 回來無聲)最終解:髒污標記 + 媒體元素 session kick** — `109348c`→`599c84d`(**2026-07 實機確認有效**)
  為何:iOS 長背景後去激活「系統層」音訊 session,context state 謊報 'running'(假死),
  且純 WebAudio 連新建 context 都接不回硬體 → 光 resume/重建皆實機無效。
  三層對策:①退背景 >8s 標髒(visibilitychange 計時),回來第一次手勢無視假 running 強制重建;
  ②currentTime 500ms 未前進(殭屍驗屍)也標髒;③髒污恢復的手勢內先播 ~1s 無聲 <audio>
  重激活系統 session(媒體元素為 iOS 唯一可靠手段;舊常駐 loop 因此從無此 bug),1.5s 後卸載不常駐。
  韌性:重建失敗保留髒污(下一按再試)、重建後對新 context 再驗屍。
  代價:恢復瞬間鎖屏控制器可能短暫閃現(~1.5s);恢復「會要等一下」屬可接受(使用者定案)。
  落選:只信 state(被謊報跳過)、加回常駐 loop(控制器回歸)、非手勢重建(連環重建)。

## 版面 / 主題

- **控制列最終形態:主列=節拍器/A4/琴鍵數/首調/和弦,選單=音色/滑動/八度/主題** — `a56a9ee`
  (歷程:`899fb6a` 全收選單 → `e8694c6` 全回主列(雙列合併盒) → 使用者檢視後定案折中)
  為何:動態島/瀏海機橫幅可用寬僅 ~714/738px,全平鋪爆三排。⚙ 在卷軸列右端(不佔控制列寬)。
  實測一般(832)/瀏海(738)/動態島(714)皆兩排、主列各盒 flex 撐滿列寬。
  另:選單面板絕對定位不含 .app 的 safe-area padding,left/right/top 須各加
  env(safe-area-inset-*) 才不會被瀏海遮(教訓);keyboard min-height 48%→40%
  (控制列偶發較高時鍵盤縮小但完整可見,不得溢出裁切;`d114291`)。

- **自訂主題:鍵盤/背景/啟動三色自選,其餘依亮度衍生** — `edd0a0d`
  為何:只開放 3 色,面板/按鈕/文字明暗/邊框/卷軸/拍點由亮度公式自動衍生,
  避免使用者選出不可讀組合;白鍵維持純白(規格)。原生 `<input type="color">`(iOS 14+)。
  自訂色存 localStorage `custom{kb,bg,accent}`;三種預設主題保留。
  `.on` 狀態在 `body.theme-custom` 區塊內重宣告(specificity,同粉紅主題教訓)。

- **鍵盤延伸到畫面最底:`.app` `padding-bottom:0`(移除底部 safe-area 留白)** — `961a903`
  為何:鍵盤本以 `flex:1 1 auto` 撐滿,但 `.app` 底部 `calc(env(safe-area-inset-bottom)+6px)`
  在 iPhone 橫幅實機因 home indicator 撐出 ~27px 深色留白。改 `padding-bottom:0` 讓白鍵貼齊底邊。
  上/左/右 safe-area 保留避瀏海;home indicator 為半透明覆蓋層,只攔上滑手勢不影響點按。
  白鍵略高(比例 3.16→3.58,真鋼琴鍵本就高),不破壞比例,故不採「整體置中」方案。
  落選:保留底部 safe-area(留白仍在)、整體垂直置中(flex 已填滿,無多餘空間可分配,無效)。

- **鍵盤占畫面主體:`min-height` 保底 + 控制列 `flex-shrink:0`** — `75225af`、`82d9d86`
  為何:使用者要琴鍵為主。控制列變高時曾把卷軸 flex 壓到 2px 不能拖 → 加 `flex-shrink:0`,
  鍵盤 `min-height:48%`。實測寬屏鍵盤 ~53–67% 皆 > 其它區加總。

- **主題用 CSS 變數 + `body.theme-*`** — `7836bc1`;粉紅演進 `0b5e049`→`82d9d86`→`b693296`
  為何:一處切換全鍵盤/面板。粉紅最終:黑鍵 #DEB0C4、面板 #FFFAFA、白鍵純白 #FFFFFF、
  執行中狀態玫瑰粉 #C2537F(不用綠色以免與粉衝突)。白鍵維持白(規格)。
  註意 specificity:`body.theme-pink .chord-toggle` 會蓋 `.on`,故 `.on` 需在主題區塊內重宣告。

- **A2HS 名稱 Tunable Piano + 程式產生鋼琴圖示** — `627f7be`、`82d9d86`
  為何:加入主畫面要英文名 + 鋼琴縮圖。圖示用 Python 純 stdlib(zlib+struct)產 PNG,
  鍵盤內縮進 iOS 圓角安全區(邊距 27/180)避免四角裁切。產圖腳本在 session scratchpad,非 repo。
