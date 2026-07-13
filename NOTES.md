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

## M1 — 音訊引擎 + A4 可調
- 音高公式:`midiToFreq(midi)=a4×2^((midi−69)/12)`,`playNote` 於發聲當下算頻率 → 改 A4 下一音即時套用,無需重建 synth。
- 音源/包絡:`PolySynth(Tone.Synth)`,`triangle`;`attack 0.01/decay 0.15/sustain 0.8/release 1.8`,`triggerAttackRelease(freq, 0.1)`。實測 0.59 起音、2.0–2.5s 窗 RMS/peak=0 → ~2 秒內完全漸弱。
- **防爆音(關鍵決策)**:
  - 落選:`Tone.Limiter(-1)`。理由:它是 DynamicsCompressor(有 ~3ms attack、ratio 有限,非硬限),實測 6 鍵同響峰值仍達 **2.73**(無限幅 3.22),爆音未解。
  - 採用:最後一級 `WaveShaper` 軟削波,`softClip`(knee 0.7:|x|≤0.7 線性、之上 tanh 飽和)。WaveShaperNode 先把輸入鉗到 [-1,1] 再查表 → 輸出必然有界 `softClip(1)=0.9285`。實測 6 鍵/12 鍵峰值皆 **0.9285<1**,單音峰值 ~0.48<knee 在線性區保持乾淨、不改變基頻。
  - 軟削波置於 masterGain **之後**(最後一級):任何主音量(M5)都不會爆音。`masterGain` 預設 0.6。
- 引擎參數以 `CONFIG` 單一真實來源暴露(`AudioEngine.config`/`softClip`),供測試重建同一條鏈,確保「測的就是實作的」。
- **量測方法(環境限制→改法)**:headless 預覽的即時 `AnalyserNode` 收不到音訊(連獨立 Tone.Synth 亦峰值 0,非引擎 bug)。改用 `Tone.Offline` 離線渲染取樣 buffer,以自相關+拋物線內插測基頻(合成 440/261.626 驗證器誤差<0.1Hz)。四例實測誤差 ≤0.094Hz(<0.5Hz)。
- A4 UI:`−/＋/preset` 綁 `pointerdown`;number input `change` 鉗制回寫;範圍 415–445、步進 1、四捨五入。實測各路徑鉗制正確。

## M2 — 鍵盤渲染 + 音名
- **鍵盤形態(定案,推翻先前判讀)**:採**傳統鋼琴外觀**(白鍵滿高並排、黑鍵較窄疊於白鍵交界上方),非等寬半音直條。使用者明確指定。
  - 連帶定義:**可視鍵數 = 白鍵數**;單白鍵寬 = 容器寬 / 白鍵數;黑鍵寬 = 白鍵寬 × 0.62、高 62%、置於下側白鍵右緣中心、z-index 疊上。
- 資料模型:midi 33–84 共 52 鍵;白鍵 pc∈{0,2,4,5,7,9,11};八度 `floor(midi/12)−1`;白鍵 label=音名、黑鍵空。白鍵總數 31。
- 渲染:白鍵 `left=j×whiteWidth%`、絕對定位;黑鍵僅在兩側白鍵**皆可見**時繪製。預設視窗自 C4 起 12 白鍵(C4–G5),含 A4。M3 才做 +/− 與卷軸移動。
- 互動:每鍵 `pointerdown`→`playNote(midi)`+`.active`;放開用**全域** `pointerup/pointercancel` 依 `pointerId` 精準復原(多點觸控正確,放開在鍵外亦可)。`setPointerCapture` try/catch 保護。`key-label` 設 `pointer-events:none` 讓命中落在鍵本體。
- 實測:52 鍵模型正確;12 白+8 黑 DOM;白鍵標 C4–G5、黑鍵無字;點白/黑鍵發對應 midi、變色、放開復原;多點各自復原;無 console error。

## M3 — 鍵數增減 + 卷軸
- 狀態仍歸 keyboard.js:新增 `setVisibleWhiteCount`(6–20 鉗制)、`setStartWhiteIndex`([0,maxStart] 鉗制)、getters(totalWhites=31、maxStartWhiteIndex)。
- **縮放錨點**:改鍵數保留左緣(startWhiteIndex 不動、僅必要時鉗回)。理由:行為可預期,實作簡潔。
- 卷軸(ui.js):拇指寬 ∝ count/31、位置 ∝ start/maxStart;拖曳用 `setPointerCapture`+`pointermove` 換算 start;點軌道空白處視窗中心跳轉;`resize` 與改鍵數後重新 `sync()`。因 max 20<31 永遠可捲。
- 實測:+/− 鉗制 6–20;白鍵寬即時 16.67%/8.33%/5%;拇指寬 19.35%/38.71%/64.52%(=count/31);start 0→A1(33)、maxStart 19→C6(84);拖曳超界鉗制(0 / 19);拖中間 start≈10;無 console error。

## M4 — 節拍器
- 排程:`Tone.Loop((time)=>…,'{den}n').start(0)` + `Tone.Transport`;每拍在精確 audio `time` 觸發 click,**非 setInterval 發聲**。
- 節拍音:獨立 `Tone.Synth`(square,極短包絡)1000Hz/20ms,`toDestination`,與 PolySynth 分離,音量 −6dB。
- 拍號:`beatsPerBar=numerator`(拍點數/循環)、`beatNote=denominator+'n'`(改 den 換 loop.interval);denominator∈{2,4,8}、numerator 1–12;目前無重音。
- BPM:`Transport.bpm.value`,20–400 鉗制、步進 1。
- tap:最近 2 下 `60000/Δms`,>3000ms 重置;`tap(now?)` now 可注入測試。
- 視覺:`Tone.Draw.schedule(...,time)` 對齊 audio clock 點亮 dot。
- **環境限制(明說)**:preview 分頁為 hidden(`document.hidden=true`、rAF 500ms 內 0 次),故 `Tone.Draw`/rAF 暫停、live dot 不亮 —— 非程式 bug,可見分頁/實機才會亮(留 M6 實機確認)。加測試探針 `_onClick`(排程時間)、`_fireBeat`(視覺映射,繞 rAF)以確定性驗證。
- 背景節流不飄拍:Transport 用 audio-clock 前瞻排程,已排事件照 audio clock 觸發;headless 無法真模擬背景節流,以架構+time 均勻性佐證。
- 實測:BPM120→間隔 **0.5000s**、jitter **0ms**;離線渲染 onset 0/0.5/1.0/1.5/2.0s 無累積漂移、peak 0.95;tap 1000/1500/1900→120/150、重置與 20/400 鉗制正確;4/4·3/4·6/8 → dots 4/3/6、beatIndex 循環正確、den→interval 0.5/0.5/0.25s;dot 映射 `_fireBeat` 正確;無 console error。

## M5 — 音量 + Drone + 狀態保存
- **主音量**:= 既有 `masterGain`(琴鍵 + drone),0–100%→0–1,即時 `masterGain.gain.value`。節拍器**獨立於主音量**。
- **小重構(修 latent 爆音)**:節拍器 click 由 `toDestination` 改接 `AudioEngine.output`(軟削波輸入,masterGain 之後)→ 全域(密集和弦+click)經同一軟削波,實測 globalPeak **0.9285<1**,不受主音量。M1 頻率回歸 440.051 未變。
- **Drone**:獨立 `Tone.Synth`(sustain=1、`triggerAttack` 持續、解除時 0.3s release),接 masterGain。多鍵 map。長按 >450ms 切換(短按不切);`.drone` 視覺(琥珀內框+頂點),重繪依 `isDrone(midi)` 保留。A4 改變即時重新調音(`setA4` 更新各 drone `frequency`)。離線:drone t=2.5s RMS 0.35(持續)vs 一般音 0(已衰減)。
- **狀態保存**:localStorage `tunable-piano-v1` 存 `{a4,volume,bpm,num,den,whiteCount,startWhite}`,去抖 150ms;`loadAndApply()` 開場套用 + `refreshers` 統一刷新顯示。drone/播放中不存。
- **Bug(修正)**:卷軸 `sync()` 在 `#app` 仍 hidden 時執行 → `clientWidth=0` → 拇指寬 `NaN%` 未設(fresh load 拇指空白)。根因:main.js 先 init 模組才顯示 app。修法:**先 `appEl.hidden=false` 再** init 需量測 DOM 的模組。修後 fresh load 拇指寬 32.26%(=10/31)正確。
- 實測:主音量 setter/clamp(0/1)、離線 peak 比例 0.5;drone on/off、A4 440→432 drone 261.63→256.87;長按切換 + 重繪保留 + 短按不切;localStorage 存檔與 reload 還原(引擎+顯示全對);無 console error。

## 收尾修正(M5 後)
- **解鎖 bug(「點擊開始沒反應」)**:原 `unlock` 為 async 且整個 UI **gate 在 `await Tone.start()`**;若該 promise 未解析(iOS 邊界)或任一 init 拋錯,就停在解鎖畫面(按鈕只閃 :active、無反應)。改為**同步**:手勢內同步觸發 `Tone.start()`(不 await,resume 已在手勢內發生),立即建 UI,整段 `try/catch`,失敗即 `unlocked=false` 並讓錯誤浮現,絕不留死畫面。**註**:preview harness 的座標點擊在隱藏分頁不派送事件(`window.__ev` 空),無法在此重現使用者原始失敗;修法針對最可能成因,實機待確認。
- **停止 Drone 按鈕**:`AudioEngine.stopAllDrones()` + 控制列按鈕,清所有 drone 與 `.key.drone` 視覺。解決 drone 鍵被捲出視窗/忘記哪顆而停不掉。實測建 drone→按鈕→drones=[]、無殘留視覺。
- **版面(琴鍵占主要比例)**:移除 A4 預設鍵(440/442/432/415);主音量滑桿縮小 + 「停止 Drone」縮小併為單列;控制列整體緊湊化(stepper/input 40→32px、padding/label/gap 縮小)。鍵盤 `min-height:55%` 保底 + `flex:1`。實測:812×375 鍵盤占 67%、720×390(控制列換 2 行)占 53%,皆 > 控制列+卷軸加總。

## 部署
- GitHub:repo `marimbacheng/tunable-piano`(public),branch `main`。
- GitHub Pages:main / root,網址 https://marimbacheng.github.io/tunable-piano/(HTTPS 強制)。資產全相對路徑,子路徑正常。
- 上線驗證:7 個資產皆 200;部署內容含最新(無 a4-preset、有 drone-stop、同步解鎖、stopAllDrones)。
- 實機待確認:iOS Safari 解鎖後發聲、橫向、M4 拍點亮燈、觸感。離線 PWA 未做(Tone.js 仍走 CDN,屬 M6)。

## 後續調整
- **移除 Drone 功能**:依需求整包移除 —— audio.js(drones map / droneOn/Off/toggle/stopAll/isDrone/droneInfo / setA4 重新調音)、keyboard.js(長按 timer / .drone 視覺)、ui.js(停止 Drone 按鈕綁定)、index.html(按鈕)、css(.drone-stop / .key.drone)。keyboard 回到單純點按發聲。
- **八度切換**:keyboard `shiftOctave(±1)` = 移動視窗 7 個白鍵(一個八度)、鉗制不出界;`leftmostName` 顯示視窗最左白鍵科學音名。控制列新增「八度」block(◀ / 音名 / ▶),與節拍器/A4/琴鍵數**同一列**。與卷軸共享視窗狀態:`refreshWindow()` 同步卷軸拇指 + 八度顯示(八度鈕、卷軸拖曳、改鍵數皆呼叫)。八度非新存欄位(由 startWhite 導出)。
- 實測:drone API 皆 undefined、長按不生 drone、無殘留視覺、無 console error;八度 C4→(inc,頂端鉗制)F4、(dec×2)F2,顯示與拇指同步;版面 812×375 鍵盤 53% 仍 > 控制列+卷軸加總(八度在頂列、主音量換至第 2 列)。

## 大改版(9 項)
- **主音量固定 1.0、移除拉桿**:音量交給裝置硬體鍵;`setMasterVolume` API 一併移除,localStorage 不再存 volume(舊值忽略)。
- **長按延音**:`playNote(固定 0.1s)` 改 `noteOn(midi)→freq` / `noteOff(freq)`;pointerdown 起音、pointerup 才進 release(1.8s 尾)。release 用 noteOn 回傳的 freq 配對,A4/首調中途改不會漏收。render 前先收掉按住中的音(防重繪殘響)。實測:按住 1.2s RMS 0.146 持續、放開 2.1s 後歸零。
- **A4 預設鍵回歸**(415/432/440/442,20px 高小方塊,視覺占比小);預設 440。
- **卷軸絲滑 + 中央圓點**:拖曳時拇指連續跟手(不量化),索引變了才重繪鍵盤;放手才吸附。`.thumb::after` 7px 圓點提示可滑。
- **首調(transpose)**:`AudioEngine.setTranspose(±6)`;noteOn 套 `midi+transpose`。UI「首調(C4=)」−/＋,顯示 `+2 D` / `-1 B` / `0 C`。persist。實測 +2 時 noteOn(60)=293.66Hz=D4。
- **和弦模式(順階)**:鍵盤即首調音階(C4=do),白鍵 pc→級數三和弦:C/F/G 大 [0,4,7]、D/E/A 小 [0,3,7]、B 減 [0,3,6];黑鍵/按住「強制大」→大三和弦(調外用,放開恢復)。觸發的 3 音鍵全部 `.active` 顯示。首調位移由 noteOn 統一套用(D 大調按 C 鍵=DF#A 自動成立)。實測 C→CEG、D→DFA、A→ACE、強制 D→DF#A。
- **破音修正**:根因=聲部過熱推進軟削波 tanh 飽和區。`voiceDb -12` 預留 headroom → 3 音和弦峰值 0.640 < knee 0.7 **全線性**;6 音極端 0.897 有界;頻率回歸 440.051 不變。音量損失由硬體音量補償。
- **黑白鍵交界陰影**:黑鍵 box-shadow 左右/下 3px 窄範圍淺陰影。
- **主題**:CSS 變數 + body class;「經典」「深灰(白鍵=深灰)」「粉紅(黑鍵=粉紅)」三選,小圓色塊切換,persist。
- **版面 bug(修正)**:控制列變高後 scrollbar 被 flex 壓到 2px 無法拖曳 → `.controls`/`.scrollbar` 加 `flex-shrink:0`,鍵盤 min-height 55%→48%。修後 scrollbar 15px、無 overflow、鍵盤 50% 仍 dominant。

## 和弦強化 + 粉紅色號
- **粉紅色號**:`--bk` 改 #ECB3CB(PANTONE 203 C),active #d68fb0、border #c07b9b,swatch 同步。實測 rgb(236,179,203)。
- **和弦品質選擇**:「強制大」按住鈕**移除**,改品質單選列(順階/M/m/dim/M7/7/m7/ø7)與和弦鈕同一行 —— 理由:按住鈕只能出大三和弦,選擇列通用且單手可操作。`QUALITIES` 表:maj[0,4,7]、min[0,3,7]、dim[0,3,6]、maj7[0,4,7,11]、dom7[0,4,7,10]、min7[0,3,7,10]、hdim7[0,3,6,10];順階=原 DIATONIC。實測七種品質音組與代號皆正確(CM7/C7/Dm7/Dø7/Bdim/Cm/順階 Dm)。
- **和弦辨識**:keyboard 追蹤按住音集合(`held` 計數 map + `onHeldChange` 回呼),ui `recognizeChord`:唯一 pc 依實際音高低→高當根音候選,相對半音集合比對模板(含 aug/dim7 順手支援);**依實際發聲音高**(含首調)命名。同一顯示器同時服務和弦模式與手動按音。實測 CEGB→CM7、CEG→C、轉位 EGC→C、首調+2 按 CEG→D、放開→「—」。
- **headroom 再修**:4 音和弦峰值 0.762 略過 knee → `voiceDb -12→-13`,實測 3 音 0.571、4 音 0.680 皆 <0.7 全線性。
- **版面**:和弦區改單行後控制列 150px、鍵盤 187px(dominant)、無 overflow。

## 加入主畫面(A2HS)名稱與圖示
- 名稱:`<title>` 與 `apple-mobile-web-app-title` 改 **Tunable Piano**;manifest `name/short_name` 同。
- 圖示:Python 純 stdlib 產生鋼琴鍵盤 PNG(180/192/512,`icons/`);`apple-touch-icon`(iOS)+ manifest icons(Android)。
- manifest:`start_url: "."` 相對路徑(Pages 子路徑安全)、standalone、theme #101015。產圖腳本在 session scratchpad,非 repo 資產。
- 注意:iOS 對 A2HS 資訊有快取,已加入過主畫面的要移除重加才會換名/換圖。

## 粉紅主題柔和化 + 面板同色系
- 黑鍵 #ECB3CB(S60/L81)→ **#D4A4B8**(S≈36/L≈74,降飽和降亮度);active #bd8aa0、border #a87f92、色塊同步。
- 粉紅主題延伸到整個面板:單一 `body.theme-pink` 覆蓋區塊(不動經典/深灰):body #251c21、panel #2f242b、stepper #3d2c36(粉邊框)、輸入框/小按鈕/tap/卷軸/拍點全套莫夫色系;accent(A4 顯示、和弦亮起、拍點 active)#e6aac6/#efb6d2。
- 清晰度決策:**執行中綠色狀態保留**(節拍器 on、和弦 on)——功能狀態辨識優先於色系一致;白鍵維持白(規格)。
- 注意 CSS specificity:`body.theme-pink .chord-toggle` 會蓋過 `.chord-toggle.on`,故 `.on` 狀態需在主題區塊內明確重宣告。
- 實測:粉紅各元素計算色值正確;切回經典完全不受污染;無 console error。

## 音色切換 + 殭屍音訊終局 + 控制列最終形態
- **鋼琴取樣**:Salamander 24 檔 1.8MB;headroom 離線量測 4 音和弦 -10dB→0.258/-8→0.325/-6→0.409 皆<0.7 全線性;密集彈奏(4音×6連擊)-6dB 峰值 0.517 仍全線性;音準 440→441.55/432→433.48(相對位移 -31.9 音分=理論值;+6 音分為取樣非諧性,對照組合成音 440.01 證方法無偏)。
- **破音歷程**:疑鏈路→量測否決→加 85Hz 高通+-9dB(裝置端假設)→實機確認為個別硬體問題+低音太小聲→**移除高通、退回 -6dB(定案 `e8694c6`)**。
- **殭屍音訊(實機確認修復)**:state 謊報 running + 純 WebAudio 重建無效 → 髒污標記(>8s)+ currentTime 驗屍 + 手勢內無聲 <audio> kick(1.5s 後卸載)。驗證:謊報 running 下第一按重建+發聲;3s 不標髒/12s 標髒;時鐘凍結 500ms 標髒;健康路徑零誤標;kick 播放→卸載全流程。
- **控制列**:「琴鍵數・八度」「音色・滑動」雙列合併盒 + ⚙ 於卷軸列 → 一般/瀏海 738/動態島 714 皆兩排(先前全平鋪會三排、全收選單被使用者退回)。選單面板 left/right/top 須加 env(safe-area-inset-*)(絕對定位不含 .app padding,曾被瀏海遮)。

## 切回無聲修復 + 卡長音 + 滑動換音域 + 自訂主題
- **切回 app 無聲(實機確認修復)**:根因=移除無聲 loop 後 playback session 的 interrupted context 光靠 resume() 救不回。策略:手勢內 interrupted→整組重建 context(見 DECISIONS `bade9b0`)。實測矩陣:手勢+interrupted 一次重建、真手勢後 running;suspended 卡死第 2 次手勢重建;非手勢絕不重建(resume 呼叫 5 次封頂);正常 suspended resume 恢復不重建;重建後節拍器 240BPM/1.5s 走 6 拍(理論 6)、bpm/拍號保留。
- **Tone 過期綁定(陷阱)**:`Tone.context` setContext 後仍指舊物件(state=closed)→ 曾致無限重建;`Tone.Transport.position` 於重建後 crash(getTicksAtTime undefined)。全改 getContext()/getTransport()/getDraw()。
- **卡長音**:同頻引用計數(同音兩次 attack→聲部數 1,修正前 2)+ 靜音看門狗(放開 2.5s 後重建 synth,dispose 已驗、按住期間不動作)。
- **滑動換音域**:錨點制;拖左 16→19(撞 maxStart 鉗制)、拖回 19→14(A3),卷軸/八度同步、按住音自動釋放、slide:true 入 localStorage。實機確認。
- **自訂主題**:三色(#2a6f97/#f5ede3/#d1495b 測例)→亮背景自動深文字、白鍵維持白、accent 深→白字;重載三色/主題/選擇器可見性全還原;三預設互切無污染。
- **本機開發陷阱**:python http.server 無 cache header,瀏覽器供舊 JS(重載也不換)→ 測試曾對舊檔誤測。對策:no-store 自訂 server(scratchpad/nocache_server.py)或換 origin(localhost↔127.0.0.1)。線上 Pages 有正常 cache 頭,不受影響。

## 粉紅淺色化 + 靜音出聲 + icon 內縮 + 防卡音
- **粉紅主題二修**:黑鍵 #D4A4B8→**#DEB0C4**(亮度略升);上方介面全面淺色化 **#FFFAFA**(body/panel),深梅紫文字 #4a3540、粉調邊框/按鈕/卷軸,鍵盤底 #eadfe4;綠色執行狀態仍保留。實測色值正確、經典無污染。
- **iOS 靜音模式出聲**:解鎖手勢內 (a) `navigator.audioSession.type='playback'`(iOS 16.4+);(b) 後備:循環播放無聲 wav `<audio>`(data URI,強制 playback session)。**實機靜音鍵行為未在此環境驗證**,留待 iPhone 確認。
- **icon 內縮**:鍵盤區邊距 14→27(左右)、底 170→150,四角落在 iOS 圓角遮罩(r≈22%)安全區內,不再裁切。重產 180/192/512。
- **防卡音(根因分析)**:偶發卡音來自 (a) iOS 放開事件遺失(pointerup 未達)或 (b) Tone PolySynth 同音重疊時 triggerRelease 配對失敗(已知問題)。雙層保險:①最後一指放開時 `AudioEngine.releaseAll()`(此刻不應有持續音,兜住配對失敗);②`visibilitychange(hidden)/pagehide/blur` → `releaseAllPressed()` 強制收音+清視覺+清 held(兜住事件遺失)。實測:雙指先後放開→最後一指觸發 releaseAll;down 後 blur(模擬事件遺失)→ 收音、active 清除、和弦顯示歸「—」。
