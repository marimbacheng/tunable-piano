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
    softKnee: 0.7           // 軟削波拐點：|x|≤knee 完全線性（乾淨），之上平滑飽和（安全網）
  };

  let a4 = 440;             // 基準頻率（Hz）
  let transpose = 0;        // 首調位移（半音;+2 = 按 C4 發 D4）
  let synth = null;         // Tone.PolySynth
  let masterGain = null;    // 固定 1.0（保留節點供量測鏈一致）
  let shaper = null;        // 軟削波（保證輸出有界不爆音）

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

  // 訊號鏈：PolySynth(-10dB) → Gain(1.0) → 軟削波 → Destination
  function init() {
    if (synth) return;       // 冪等
    shaper = new Tone.WaveShaper(softClip, 4096).toDestination();
    masterGain = new Tone.Gain(CONFIG.masterGain).connect(shaper);
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: CONFIG.oscillator,
      envelope: CONFIG.envelope
    }).connect(masterGain);
    synth.volume.value = CONFIG.voiceDb;
  }

  // 按下：開始發聲（含首調位移），持續到 noteOff;回傳實際觸發頻率供釋放配對
  function noteOn(midi) {
    if (!synth) return null;
    const freq = midiToFreq(midi + transpose);
    synth.triggerAttack(freq);
    return freq;
  }

  // 放開：釋放對應頻率的聲部（用 noteOn 回傳的 freq,避免 A4/首調中途變動配錯）
  function noteOff(freq) {
    if (!synth || freq == null) return;
    synth.triggerRelease(freq);
  }

  // 釋放所有聲部（防卡音保險：release 配對失敗或放開事件遺失時的兜底）
  function releaseAll() {
    if (synth) synth.releaseAll();
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
    init, noteOn, noteOff, releaseAll, midiToFreq,
    setA4, getA4, setTranspose, getTranspose,
    softClip,
    get config() { return CONFIG; },     // 供量測重建同一條鏈
    get output() { return shaper; }      // 供量測接分析器 + 節拍器接入軟削波
  };
})();

window.AudioEngine = AudioEngine;
