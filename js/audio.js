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
    silenceRebuildMs: 2500
  };

  let a4 = 440;             // 基準頻率（Hz）
  let transpose = 0;        // 首調位移（半音;+2 = 按 C4 發 D4）
  let synth = null;         // Tone.PolySynth
  let masterGain = null;    // 固定 1.0（保留節點供量測鏈一致）
  let shaper = null;        // 軟削波（保證輸出有界不爆音）
  const active = new Map(); // freq → 按住計數：同頻率只 attack 一次（防重疊聲部觸發卡音）
  let watchdogTimer = null; // 靜音看門狗計時器

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

  // 訊號鏈：PolySynth(-13dB) → Gain(1.0) → 軟削波 → Destination
  function init() {
    if (synth) return;       // 冪等
    shaper = new Tone.WaveShaper(softClip, 4096).toDestination();
    masterGain = new Tone.Gain(CONFIG.masterGain).connect(shaper);
    synth = buildSynth();
  }

  // 恢復 AudioContext：iOS 切離 app/鎖屏後 context 停在 suspended/interrupted，
  // 回到 app 不會自動恢復 → 頁面可見/手勢時呼叫（手勢內 resume 最可靠）
  function ensureRunning() {
    try {
      if (Tone.context.state !== 'running') {
        const p = Tone.context.resume();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (_) {}
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
      } catch (_) {}
    }, CONFIG.silenceRebuildMs);
  }

  // 按下：開始發聲（含首調位移），持續到 noteOff;回傳實際觸發頻率供釋放配對。
  // 同頻率已在發聲（和弦模式重疊音、多指同鍵）只加計數不重複 attack —— 消除
  // PolySynth 同頻多聲部的 release 配對歧義（卡音主要觸發條件）與同音相位疊加。
  function noteOn(midi) {
    if (!synth) return null;
    ensureRunning();          // 手勢內兜底恢復：切回 app 後第一次按鍵即恢復音訊
    cancelWatchdog();
    const freq = midiToFreq(midi + transpose);
    const n = active.get(freq) || 0;
    if (n === 0) synth.triggerAttack(freq);
    active.set(freq, n + 1);
    return freq;
  }

  // 放開：計數歸零才真正釋放（用 noteOn 回傳的 freq,避免 A4/首調中途變動配錯）
  function noteOff(freq) {
    if (!synth || freq == null) return;
    const n = active.get(freq);
    if (n == null) return;    // releaseAll 已清過 → 忽略,避免誤釋放同頻新音
    if (n <= 1) {
      active.delete(freq);
      synth.triggerRelease(freq);
    } else {
      active.set(freq, n - 1);
    }
    if (active.size === 0) scheduleWatchdog();
  }

  // 釋放所有聲部（防卡音保險：release 配對失敗或放開事件遺失時的兜底）
  function releaseAll() {
    active.clear();
    if (synth) synth.releaseAll();
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
    softClip,
    get config() { return CONFIG; },     // 供量測重建同一條鏈
    get output() { return shaper; },     // 供量測接分析器 + 節拍器接入軟削波
    // 測試探針（同 Metronome._onClick 慣例）：驗證引用計數與看門狗重建
    get _synth() { return synth; },
    get _activeSize() { return active.size; }
  };
})();

window.AudioEngine = AudioEngine;
