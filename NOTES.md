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
