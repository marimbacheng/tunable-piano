// audio.js — 音訊引擎（等律音高公式、PolySynth、長按持續發聲、首調移調、防爆音）
// 律制固定等律，A4 只平移基準：f = a4 × 2^((midi − 69) / 12)
const AudioEngine = (function () {
  'use strict';

  const A4_MIN = 415;
  const A4_MAX = 445;
  const TRANSPOSE_MIN = -6, TRANSPOSE_MAX = 6;   // 首調半音位移範圍（涵蓋所有調性）

  // 引擎參數的單一真實來源（供量測重建，確保測試與實作一致）
  const CONFIG = {
    oscillator: { type: 'triangle' },
    // 長按持續：sustain 段維持發聲，放開後 release 收尾;短點一下≈原本 ~2 秒尾音
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.8, release: 1.8 },
    masterGain: 1.0,        // 主音量固定 100%（音量交給裝置硬體鍵）
    voiceDb: -13,           // 每聲部預留 headroom：3/4 音和弦峰值皆 <0.7（knee）全線性 → 修破音感
    softKnee: 0.7,          // 軟削波拐點：|x|≤knee 完全線性（乾淨），之上平滑飽和（安全網）
    // 靜音看門狗：最後一音釋放 2.5s 後（release 1.8s 尾音已結束 + 餘裕）重建 synth。
    // 兜住 Tone.PolySynth 聲部追蹤遺失（同音快速重觸發）造成 releaseAll 也收不掉的卡長音。
    silenceRebuildMs: 2500,
    // 鋼琴取樣：release=放開後的收音淡出。
    // 離線量測:密集彈奏(4音和弦×6連擊)-6dB 峰值 0.517、0% 超 knee → 我方鏈路全線性,
    // 實機「破破感」來自裝置端(小喇叭低頻過載/iOS 輸出限幅)。對策:
    // ①鋼琴路徑高通 85Hz(小喇叭發不出的超低頻純耗喇叭衝程);②-9dB 少推輸出限幅。
    samplerRelease: 1.2,
    samplerDb: -9,
    samplerHpfHz: 85
  };

  let a4 = 440;             // 基準頻率（Hz）
  let transpose = 0;        // 首調位移（半音;+2 = 按 C4 發 D4）
  let synth = null;         // Tone.PolySynth
  let masterGain = null;    // 固定 1.0（保留節點供量測鏈一致）
  let shaper = null;        // 軟削波（保證輸出有界不爆音）
  const active = new Map(); // freq → {count,inst}：同頻率只 attack 一次,release 回到原樂器
  let watchdogTimer = null; // 靜音看門狗計時器

  // ===== 音色：合成音（預設,即開即用）/ 鋼琴取樣（背景載入,載完可切） =====
  // Salamander Grand Piano(CC BY 3.0)子集:每小三度一檔 C1–A6 共 24 檔,自帶於 audio/piano/。
  // 檔名 s=升記號(Ds1=D#1)。AudioBuffer 與 context 無關,快取後重建 context/看門狗可復用不重載。
  const PIANO_BASE = 'audio/piano/';   // 相對路徑（Pages 子路徑相容）
  const PIANO_NOTES = [
    'C1','Ds1','Fs1','A1','C2','Ds2','Fs2','A2','C3','Ds3','Fs3','A3',
    'C4','Ds4','Fs4','A4','C5','Ds5','Fs5','A5','C6','Ds6','Fs6','A6'
  ];
  let timbre = 'synth';         // 'synth' | 'piano'（piano 需樣本就緒才實際發聲,否則先用合成音）
  let sampler = null;           // Tone.Sampler
  let samplerHpf = null;        // 鋼琴路徑高通（防小喇叭低頻過載;合成音路徑不經過）
  let pianoBuffers = null;      // 音名 → AudioBuffer（解碼快取）
  let pianoStatus = 'idle';     // idle | loading | ready | error
  let pianoLoadPromise = null;
  let onPianoStatus = null;     // cb(status, progress 0–1)：UI 顯示載入進度

  // 等律音高公式（僅平移基準）
  function midiToFreq(midi) {
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  // 記憶體無關的軟削波：|x|≤knee 線性，之上 tanh 平滑飽和;輸出必然有界（|y|<1）
  function softClip(x) {
    const k = CONFIG.softKnee, aa = Math.abs(x);
    if (aa <= k) return x;
    const over = (aa - k) / (1 - k);
    return Math.sign(x) * (k + (1 - k) * Math.tanh(over));
  }

  // 建立 PolySynth（init 與看門狗重建共用同一配方，確保參數一致）
  function buildSynth() {
    const s = new Tone.PolySynth(Tone.Synth, {
      oscillator: CONFIG.oscillator,
      envelope: CONFIG.envelope
    }).connect(masterGain);
    s.volume.value = CONFIG.voiceDb;
    return s;
  }

  // 訊號鏈：PolySynth/Sampler(各自 headroom) → Gain(1.0) → 軟削波 → Destination
  function init() {
    if (synth) return;       // 冪等
    shaper = new Tone.WaveShaper(softClip, 4096).toDestination();
    masterGain = new Tone.Gain(CONFIG.masterGain).connect(shaper);
    synth = buildSynth();
  }

  // ===== 鋼琴取樣載入 / Sampler 建構 =====
  function notifyPiano(progress) {
    if (onPianoStatus) { try { onPianoStatus(pianoStatus, progress); } catch (_) {} }
  }

  // 單檔抓取+解碼（失敗重試一次後拋出）
  function fetchSample(note, attempt) {
    return fetch(PIANO_BASE + note + '.mp3')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + note);
        return r.arrayBuffer();
      })
      .then(function (ab) { return Tone.getContext().rawContext.decodeAudioData(ab); })
      .catch(function (err) {
        if (attempt < 1) return fetchSample(note, attempt + 1);
        throw err;
      });
  }

  // 背景載入全部樣本（冪等）;完成後建 Sampler、通知 UI
  function loadPiano() {
    if (pianoLoadPromise) return pianoLoadPromise;
    pianoStatus = 'loading';
    notifyPiano(0);
    let done = 0;
    pianoLoadPromise = Promise.all(PIANO_NOTES.map(function (n) {
      return fetchSample(n, 0).then(function (buf) {
        done++;
        notifyPiano(done / PIANO_NOTES.length);
        return [n.replace('s', '#'), buf];       // Ds1 → D#1（Tone 音名）
      });
    })).then(function (pairs) {
      pianoBuffers = {};
      pairs.forEach(function (p) { pianoBuffers[p[0]] = p[1]; });
      buildSampler();
      pianoStatus = 'ready';
      notifyPiano(1);
      return true;
    }).catch(function (err) {
      console.error('[piano] 取樣載入失敗:', err);
      pianoStatus = 'error';
      pianoLoadPromise = null;    // 允許再試（優雅退回合成音,不 crash）
      notifyPiano(0);
      return false;
    });
    return pianoLoadPromise;
  }

  // 由快取 AudioBuffer 建 Sampler（init 後、看門狗與 context 重建皆可重呼）
  // 鏈:Sampler → 高通(85Hz) → masterGain → 軟削波
  function buildSampler() {
    if (!pianoBuffers || !masterGain) return;
    try { if (sampler) sampler.dispose(); } catch (_) {}
    try { if (samplerHpf) samplerHpf.dispose(); } catch (_) {}
    samplerHpf = new Tone.Filter({ type: 'highpass', frequency: CONFIG.samplerHpfHz, rolloff: -12 })
      .connect(masterGain);
    const urls = {};
    for (const k in pianoBuffers) urls[k] = new Tone.ToneAudioBuffer(pianoBuffers[k]);
    sampler = new Tone.Sampler({ urls: urls, release: CONFIG.samplerRelease }).connect(samplerHpf);
    sampler.volume.value = CONFIG.samplerDb;
  }

  // 目前實際發聲的樂器：piano 已就緒才用 Sampler,否則退回合成音（即開即用）
  function instrument() {
    return (timbre === 'piano' && sampler && pianoStatus === 'ready') ? sampler : synth;
  }

  function setTimbre(t) {
    timbre = (t === 'piano') ? 'piano' : 'synth';
    return timbre;
  }
  function getTimbre() { return timbre; }

  // ===== 切回 app 恢復音訊（分段恢復） =====
  // iOS 切離 app 後 context 進 WebKit 特有的 'interrupted'。移除無聲 <audio> loop 後
  // 已無媒體元素替我們重新激活系統音訊 session，resume() 可能靜默無效（實機證實）。
  // 對策：手勢內遇 interrupted 直接重建 context（手勢內新建的 context 必為 running，
  // 等於重新激活 session，亦治 resume 後假 running 的殭屍 context）;
  // 非手勢路徑先試原生 resume，連兩次救不回也重建。
  let recoverTimer = null;
  let resumeAttempts = 0;      // 非手勢 resume 重試計數（有界）
  let gestureAttempts = 0;     // 手勢內 resume 未果次數（第 2 次手勢起直接重建）
  let onRebuild = null;        // context 重建後通知（main.js 掛節拍器重建）
  // 殭屍對策:iOS 退背景 10–20s 後切斷音訊硬體但 state 仍謊報 'running'(假死),
  // 光看 state 會跳過所有恢復。forceDirty=true 時下一次手勢無視 running 強制重建。
  // 來源:①main.js 退背景逾時標記;②scheduleLivenessCheck 偵測 currentTime 凍結。
  let forceDirty = false;
  let liveTimer = null;

  // 一律用 Tone.getContext()（即時）;Tone.context 為模組匯出的過期綁定，
  // setContext() 換新後仍回傳舊物件（實測 closed），誤用會造成無限重建。
  function nativeCtx() {
    try { const raw = Tone.getContext().rawContext; return raw._nativeAudioContext || raw; }
    catch (_) { return null; }
  }

  // 整組重建：新 Tone.Context → 重建本引擎鏈 → 通知節拍器重建 → 關舊 context
  function rebuildContext() {
    try {
      const old = Tone.getContext();
      const oldSynth = synth, oldGain = masterGain, oldShaper = shaper,
            oldSampler = sampler, oldHpf = samplerHpf;
      Tone.setContext(new Tone.Context({ latencyHint: 'interactive' }));
      synth = null; masterGain = null; shaper = null; sampler = null; samplerHpf = null;
      active.clear(); cancelWatchdog();
      forceDirty = false;                                       // 新 context 即乾淨
      if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
      init();
      if (pianoBuffers) buildSampler();   // AudioBuffer 與 context 無關,免重新下載/解碼
      try { if (onRebuild) onRebuild(); } catch (_) {}
      try { if (oldSampler) oldSampler.dispose(); } catch (_) {}
      try { if (oldHpf) oldHpf.dispose(); } catch (_) {}
      try { if (oldSynth) oldSynth.dispose(); } catch (_) {}
      try { if (oldGain) oldGain.dispose(); } catch (_) {}
      try { if (oldShaper) oldShaper.dispose(); } catch (_) {}
      try { const p = old.close(); if (p && typeof p.catch === 'function') p.catch(function () {}); } catch (_) {}
      return true;
    } catch (_) { return false; }
  }

  function ensureRunning(fromGesture) {
    // 重申 playback session（iOS 中斷後可能失效;維持靜音鍵也出聲）
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
        navigator.audioSession.type = 'playback';
      }
    } catch (_) {}
    try {
      const st = Tone.getContext().state;
      // 非手勢時機（切回可見/focus）順手驗屍:running 但時鐘凍結 = 殭屍 → 標髒
      if (fromGesture !== true) scheduleLivenessCheck();
      // 注意:st==='running' 可能是殭屍謊報,forceDirty 時不得走快樂路徑
      if (st === 'running' && !forceDirty) { resumeAttempts = 0; gestureAttempts = 0; return; }
      if (fromGesture === true) {
        // 重建只在手勢內做：非手勢時機建的新 context 是 suspended（仍需手勢才跑），
        // 非手勢重建無益且有連環重建風險（實測驗證）。
        // forceDirty(殭屍) / interrupted → 立即重建;suspended → 先 resume,連兩次手勢仍未恢復也重建。
        if (forceDirty || st === 'interrupted' || gestureAttempts >= 1) {
          gestureAttempts = 0;
          forceDirty = false;
          rebuildContext();
          nativeResume();   // 真手勢內新 context 本應 running;此為兜底（無害）
          return;
        }
        gestureAttempts++;
      }
      nativeResume();
      scheduleRecoverCheck();
    } catch (_) {}
  }

  // 殭屍偵測（副防線）:state 報 'running' 但 currentTime 500ms 內未前進 = 音訊硬體已被切
  // → 標髒,下一次手勢強制重建。單一計時槽,重複呼叫無累積。
  function scheduleLivenessCheck() {
    if (liveTimer) return;
    try {
      const ctx = nativeCtx();
      if (!ctx || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      liveTimer = setTimeout(function () {
        liveTimer = null;
        try {
          const c = nativeCtx();
          if (c && c.state === 'running' && c.currentTime === t0) forceDirty = true;
        } catch (_) {}
      }, 500);
    } catch (_) {}
  }

  function nativeResume() {
    const ctx = nativeCtx();     // 直接對最底層原生 context resume（繞開包裝層狀態機）
    if (ctx) {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  }

  // 非手勢搶救：有界 resume 重試（不重建）;救不回交給下一次手勢
  function scheduleRecoverCheck() {
    if (recoverTimer) return;
    recoverTimer = setTimeout(function () {
      recoverTimer = null;
      if (Tone.getContext().state === 'running') { resumeAttempts = 0; gestureAttempts = 0; return; }
      if (resumeAttempts < 4) { resumeAttempts++; nativeResume(); scheduleRecoverCheck(); }
      else resumeAttempts = 0;
    }, 300);
  }

  // 靜音看門狗：全部音釋放 silenceRebuildMs 後重建 synth。
  // 為何：Tone.PolySynth 偶發聲部追蹤遺失（同音快速重觸發），孤兒聲部連 releaseAll
  // 都收不掉 → 卡長音。dispose 舊 synth 必殺所有聲部;此刻尾音已結束、本應全靜音，聽感無感。
  function cancelWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }
  function scheduleWatchdog() {
    cancelWatchdog();
    watchdogTimer = setTimeout(function () {
      watchdogTimer = null;
      if (!synth || active.size > 0) return;   // 期間又有音按下就不動
      try {
        const old = synth;
        synth = buildSynth();
        old.disconnect();
        old.dispose();
        // Sampler 無 PolySynth 的聲部追蹤 bug,不重建;補一次 releaseAll 兜底即可
        if (sampler) sampler.releaseAll();
      } catch (_) {}
    }, CONFIG.silenceRebuildMs);
  }

  // 按下：開始發聲（含首調位移），持續到 noteOff;回傳實際觸發頻率供釋放配對。
  // 同頻率已在發聲（和弦模式重疊音、多指同鍵）只加計數不重複 attack —— 消除
  // PolySynth 同頻多聲部的 release 配對歧義（卡音主要觸發條件）與同音相位疊加。
  function noteOn(midi) {
    if (!synth) return null;
    ensureRunning(true);      // 手勢內兜底恢復：interrupted 直接重建,第一次按鍵即恢復音訊
    cancelWatchdog();
    const freq = midiToFreq(midi + transpose);
    const rec = active.get(freq);
    if (rec) {
      rec.count++;
    } else {
      const inst = instrument();
      inst.triggerAttack(freq);
      active.set(freq, { count: 1, inst: inst });   // 記住發聲樂器:中途切音色仍能正確收音
    }
    return freq;
  }

  // 放開：計數歸零才真正釋放（用 noteOn 回傳的 freq,避免 A4/首調中途變動配錯）
  function noteOff(freq) {
    if (freq == null) return;
    const rec = active.get(freq);
    if (!rec) return;         // releaseAll 已清過 → 忽略,避免誤釋放同頻新音
    if (rec.count <= 1) {
      active.delete(freq);
      try { rec.inst.triggerRelease(freq); } catch (_) {}
    } else {
      rec.count--;
    }
    if (active.size === 0) scheduleWatchdog();
  }

  // 釋放所有聲部（防卡音保險：release 配對失敗或放開事件遺失時的兜底）
  function releaseAll() {
    active.clear();
    if (synth) synth.releaseAll();
    if (sampler) { try { sampler.releaseAll(); } catch (_) {} }
    scheduleWatchdog();
  }

  // 設定 A4（415–445 鉗制、步進 1 Hz）
  function setA4(hz) {
    const v = Math.round(Number(hz));
    a4 = Math.min(A4_MAX, Math.max(A4_MIN, Number.isFinite(v) ? v : a4));
    return a4;
  }
  function getA4() { return a4; }

  // 首調位移（半音,鉗制 ±6）
  function setTranspose(n) {
    n = Math.round(Number(n));
    transpose = Math.min(TRANSPOSE_MAX, Math.max(TRANSPOSE_MIN, Number.isFinite(n) ? n : transpose));
    return transpose;
  }
  function getTranspose() { return transpose; }

  return {
    A4_MIN, A4_MAX, TRANSPOSE_MIN, TRANSPOSE_MAX,
    init, noteOn, noteOff, releaseAll, ensureRunning, midiToFreq,
    setA4, getA4, setTranspose, getTranspose,
    setTimbre, getTimbre, loadPiano,
    markDirty: function () { forceDirty = true; },   // 退背景逾時由 main.js 標記(殭屍對策)
    set onPianoStatus(cb) { onPianoStatus = cb; },
    get pianoStatus() { return pianoStatus; },
    softClip,
    get config() { return CONFIG; },     // 供量測重建同一條鏈
    get output() { return shaper; },     // 供量測接分析器 + 節拍器接入軟削波
    set onContextRebuild(cb) { onRebuild = cb; },   // context 重建後通知（節拍器重建）
    // 測試探針（同 Metronome._onClick 慣例）：驗證引用計數、看門狗與 context 重建
    get _synth() { return synth; },
    get _sampler() { return sampler; },
    get _activeSize() { return active.size; },
    get _pianoBuffers() { return pianoBuffers; },
    get _forceDirty() { return forceDirty; },
    _rebuildContext: rebuildContext
  };
})();

window.AudioEngine = AudioEngine;
