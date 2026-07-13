// metronome.js — M4：節拍器（Tone.Transport 排程，非 setInterval 發聲）
// 節拍音與琴鍵音源分離;目前無重音（每拍同音量）。
// 注意：一律用 Tone.getTransport()/getDraw()（即時）;Tone.Transport/Tone.Draw 是
// 模組匯出的過期綁定，AudioEngine 重建 context 後仍指向舊 context 的實例（會 crash）。
const Metronome = (function () {
  'use strict';

  const BPM_MIN = 20, BPM_MAX = 400;
  const NUM_MIN = 1, NUM_MAX = 12;
  const DENOMS = [2, 4, 8];
  const RESET_MS = 3000;              // 超過此間隔未 tap 則重置暫存（≈最慢可 tap 20 BPM）
  const CLICK_FREQ = 1000, CLICK_DUR = 0.02;

  let click = null;                   // 獨立節拍音源
  let loop = null;                    // Tone.Loop
  let running = false;
  let bpm = 120;
  let numerator = 4, denominator = 4;
  let beatIndex = 0;
  let onBeatCb = null;                // onBeat(index, total)：視覺亮點
  let onClickProbe = null;            // 測試探針 (time, idx, total)
  let lastTapMs = null;

  function beatNote() { return denominator + 'n'; }   // 拍單位：4→'4n'、8→'8n'

  function init(onBeat) {
    onBeatCb = onBeat || null;
    if (!click) {
      click = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }
      });
      // 接軟削波輸入（AudioEngine.output）：與 PolySynth 分離、獨立於主音量，但共用全域防爆音
      click.connect(AudioEngine.output);
      click.volume.value = -6;
    }
    Tone.getTransport().bpm.value = bpm;
    Tone.getTransport().timeSignature = [numerator, denominator];
    if (!loop) {
      loop = new Tone.Loop(function (time) {
        click.triggerAttackRelease(CLICK_FREQ, CLICK_DUR, time);   // 在精確 audio 時間發聲
        var idx = beatIndex, total = numerator;
        if (onClickProbe) onClickProbe(time, idx, total);
        Tone.getDraw().schedule(function () { if (onBeatCb) onBeatCb(idx, total); }, time);  // 視覺對齊 audio clock
        beatIndex = (beatIndex + 1) % numerator;
      }, beatNote());
      loop.start(0);
    }
  }

  function start() {
    if (running) return;
    running = true;
    beatIndex = 0;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();
  }

  function stop() {
    if (!running) return;
    running = false;
    Tone.getTransport().stop();
    beatIndex = 0;
    if (onBeatCb) onBeatCb(-1, numerator);   // 清除亮點
  }

  function toggle() { running ? stop() : start(); return running; }

  function setBpm(v) {
    v = Math.round(Number(v));
    bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Number.isFinite(v) ? v : bpm));
    Tone.getTransport().bpm.value = bpm;
    return bpm;
  }
  function getBpm() { return bpm; }

  function applyTimeSignature() {
    if (loop) loop.interval = beatNote();
    Tone.getTransport().timeSignature = [numerator, denominator];
    beatIndex = 0;
  }

  function setTimeSignature(num, den) {
    num = Math.round(Number(num));
    numerator = Math.min(NUM_MAX, Math.max(NUM_MIN, Number.isFinite(num) ? num : numerator));
    if (DENOMS.indexOf(Number(den)) >= 0) denominator = Number(den);
    applyTimeSignature();
    return { numerator: numerator, denominator: denominator };
  }
  function getTimeSignature() { return { numerator: numerator, denominator: denominator }; }

  function cycleDenominator() {
    var i = DENOMS.indexOf(denominator);
    denominator = DENOMS[(i + 1) % DENOMS.length];
    applyTimeSignature();
    return denominator;
  }

  // tap：取最近 2 下間隔換算 BPM;>RESET_MS 未 tap 則重置暫存重新起算。now 可注入以便測試。
  function tap(nowMs) {
    var now = (nowMs != null) ? nowMs : performance.now();
    if (lastTapMs != null && (now - lastTapMs) <= RESET_MS) {
      var delta = now - lastTapMs;
      lastTapMs = now;
      return (delta > 0) ? setBpm(60000 / delta) : bpm;
    }
    lastTapMs = now;                  // 首拍或重置後起算
    return null;
  }

  function isRunning() { return running; }

  // 音訊 context 重建後重生：舊 click/loop 綁在已關閉的 context 上，須丟棄後
  // 以現存 bpm/拍號/回呼重建於新 context;若原本在跑則接續跑。
  function rebuild() {
    const wasRunning = running;
    running = false;
    try { if (loop) loop.dispose(); } catch (_) {}
    try { if (click) click.dispose(); } catch (_) {}
    loop = null; click = null; beatIndex = 0;
    init(onBeatCb);
    if (wasRunning) start();
  }

  return {
    BPM_MIN: BPM_MIN, BPM_MAX: BPM_MAX, NUM_MIN: NUM_MIN, NUM_MAX: NUM_MAX, DENOMS: DENOMS,
    init: init, rebuild: rebuild, start: start, stop: stop, toggle: toggle, isRunning: isRunning,
    setBpm: setBpm, getBpm: getBpm,
    setTimeSignature: setTimeSignature, getTimeSignature: getTimeSignature, cycleDenominator: cycleDenominator,
    tap: tap,
    set _onClick(fn) { onClickProbe = fn; },     // 測試探針（audio 排程時間）
    get _onClick() { return onClickProbe; },
    _fireBeat: function (i) { if (onBeatCb) onBeatCb(i, numerator); }  // 測試探針（視覺映射，繞過 rAF）
  };
})();

window.Metronome = Metronome;
