// audio.js — M1：音訊引擎（等律音高公式、PolySynth、包絡、防爆音）
// 律制固定等律，A4 只平移基準：f = a4 × 2^((midi − 69) / 12)
const AudioEngine = (function () {
  'use strict';

  const A4_MIN = 415;
  const A4_MAX = 445;

  // 引擎參數的單一真實來源（供量測重建，確保測試與實作一致）
  const CONFIG = {
    oscillator: { type: 'triangle' },   // 奇次泛音，音高清楚不刺耳
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.8, release: 1.8 },
    masterGain: 0.6,                     // 主音量預設（M5 接 UI）
    softKnee: 0.7,                       // 軟削波拐點：|x|≤knee 完全線性（乾淨），之上平滑飽和
    noteDuration: 0.1                    // 點一下的觸發長度；由 release 主導 ~2s 漸弱
  };

  let a4 = 440;                 // 基準頻率（Hz）
  let synth = null;            // Tone.PolySynth
  let masterGain = null;      // 主音量
  let shaper = null;          // 軟削波（安全級，保證輸出有界不爆音）

  // 等律音高公式（僅平移基準）
  function midiToFreq(midi) {
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  // 記憶體無關的軟削波：|x|≤knee 保持線性（單音乾淨），之上以 tanh 平滑飽和。
  // WaveShaperNode 會先把輸入鉗到 [-1,1] 再查表，故輸出必然有界（|y|<1），
  // 無論多少鍵同響都不會硬性 clipping。
  function softClip(x) {
    const k = CONFIG.softKnee, a = Math.abs(x);
    if (a <= k) return x;
    const over = (a - k) / (1 - k);
    return Math.sign(x) * (k + (1 - k) * Math.tanh(over));
  }

  // 建立訊號鏈：PolySynth → Gain(主音量) → 軟削波(最後一級) → Destination
  // 必須在 Tone.start() 之後呼叫（context 已啟動）
  function init() {
    if (synth) return;         // 冪等
    shaper = new Tone.WaveShaper(softClip, 4096).toDestination();
    masterGain = new Tone.Gain(CONFIG.masterGain).connect(shaper);
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: CONFIG.oscillator,
      envelope: CONFIG.envelope
    }).connect(masterGain);
  }

  // 點一下＝固定短觸發，尾音在 ~2 秒內漸弱
  function playNote(midi) {
    if (!synth) return;
    synth.triggerAttackRelease(midiToFreq(midi), CONFIG.noteDuration);
  }

  // 設定 A4（415–445 鉗制、步進 1 Hz）；回傳鉗制後的值
  function setA4(hz) {
    const v = Math.round(Number(hz));
    a4 = Math.min(A4_MAX, Math.max(A4_MIN, Number.isFinite(v) ? v : a4));
    return a4;
  }

  function getA4() { return a4; }

  return {
    A4_MIN, A4_MAX,
    init, playNote, midiToFreq, setA4, getA4,
    softClip,
    get config() { return CONFIG; },     // 供量測重建同一條鏈
    get output() { return shaper; }      // 供量測/除錯接分析器（非產品功能）
  };
})();

// 供其他 script 與除錯量測取用
window.AudioEngine = AudioEngine;
