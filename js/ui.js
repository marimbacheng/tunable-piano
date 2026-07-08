// ui.js — 控制列（A4、鍵數、卷軸、節拍器、主音量）+ localStorage 狀態保存。
const UI = (function () {
  'use strict';

  // ===== 狀態保存（localStorage） =====
  const STORE_KEY = 'tunable-piano-v1';
  const refreshers = [];                 // 各控制的顯示刷新函式（載入設定後統一刷新）
  let saveTimer = null;

  function refreshAll() { refreshers.forEach(function (fn) { fn(); }); }

  function persist() {                    // 去抖寫入
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        const ts = Metronome.getTimeSignature();
        localStorage.setItem(STORE_KEY, JSON.stringify({
          a4: AudioEngine.getA4(),
          volume: AudioEngine.getMasterVolume(),
          bpm: Metronome.getBpm(),
          num: ts.numerator,
          den: ts.denominator,
          whiteCount: Keyboard.visibleWhiteCount,
          startWhite: Keyboard.startWhiteIndex
        }));
      } catch (_) {}
    }, 150);
  }

  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (_) { return null; }
  }

  // 開場套用已存設定並刷新所有 UI 顯示
  function loadAndApply() {
    const s = load();
    if (!s) return;
    if (s.a4 != null) AudioEngine.setA4(s.a4);
    if (s.volume != null) AudioEngine.setMasterVolume(s.volume);
    if (s.bpm != null) Metronome.setBpm(s.bpm);
    if (s.num != null && s.den != null) Metronome.setTimeSignature(s.num, s.den);
    if (s.whiteCount != null) Keyboard.setVisibleWhiteCount(s.whiteCount);
    if (s.startWhite != null) Keyboard.setStartWhiteIndex(s.startWhite);
    refreshAll();
  }

  let a4Input = null;
  let a4Display = null;

  function apply(hz) {
    const clamped = AudioEngine.setA4(hz);
    render(clamped);
    persist();
    return clamped;
  }

  function render(v) {
    if (a4Input) a4Input.value = String(v);
    if (a4Display) a4Display.textContent = v + ' Hz';
  }

  function initA4() {
    a4Input = document.getElementById('a4-input');
    a4Display = document.getElementById('a4-display');
    const dec = document.getElementById('a4-dec');
    const inc = document.getElementById('a4-inc');
    const presets = document.querySelectorAll('.a4-preset');

    // 初始同步顯示（AudioEngine 預設 440）
    render(AudioEngine.getA4());
    refreshers.push(function () { render(AudioEngine.getA4()); });

    dec.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      apply(AudioEngine.getA4() - 1);
    });
    inc.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      apply(AudioEngine.getA4() + 1);
    });

    // 數字輸入：change 時鉗制回寫
    a4Input.addEventListener('change', function () {
      apply(a4Input.value);
    });

    presets.forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        apply(btn.dataset.hz);
      });
    });
  }

  // ===== 可視白鍵數 +/− =====
  let keysDisplay = null;
  let syncScroll = null;

  function renderKeys() {
    if (keysDisplay) keysDisplay.textContent = String(Keyboard.visibleWhiteCount);
  }

  function initKeys() {
    keysDisplay = document.getElementById('keys-display');
    const dec = document.getElementById('keys-dec');
    const inc = document.getElementById('keys-inc');
    renderKeys();
    refreshers.push(renderKeys);
    dec.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      Keyboard.setVisibleWhiteCount(Keyboard.visibleWhiteCount - 1);
      renderKeys();
      if (syncScroll) syncScroll();
      persist();
    });
    inc.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      Keyboard.setVisibleWhiteCount(Keyboard.visibleWhiteCount + 1);
      renderKeys();
      if (syncScroll) syncScroll();
      persist();
    });
  }

  // ===== 上方卷軸 =====
  function initScrollbar() {
    const track = document.getElementById('scrollbar');
    const thumb = document.getElementById('scroll-thumb');
    let dragging = false, grabDX = 0;

    function trackW() { return track.clientWidth; }
    function thumbWpx() {
      return Math.max(24, trackW() * Keyboard.visibleWhiteCount / Keyboard.totalWhites);
    }
    function sync() {
      const w = thumbWpx(), travel = trackW() - w, maxStart = Keyboard.maxStartWhiteIndex;
      const leftPx = maxStart > 0 ? (Keyboard.startWhiteIndex / maxStart) * travel : 0;
      thumb.style.width = (w / trackW() * 100) + '%';
      thumb.style.left = (leftPx / trackW() * 100) + '%';
    }
    function leftPxToStart(leftPx) {
      const travel = trackW() - thumbWpx(), maxStart = Keyboard.maxStartWhiteIndex;
      if (travel <= 0 || maxStart <= 0) return 0;
      const frac = Math.min(1, Math.max(0, leftPx / travel));
      return Math.round(frac * maxStart);
    }

    thumb.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      grabDX = e.clientX - thumb.getBoundingClientRect().left;
      try { if (e.pointerId != null) thumb.setPointerCapture(e.pointerId); } catch (_) {}
    });
    thumb.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const leftPx = (e.clientX - track.getBoundingClientRect().left) - grabDX;
      Keyboard.setStartWhiteIndex(leftPxToStart(leftPx));
      sync();
      persist();
    });
    const end = function (e) {
      dragging = false;
      try { if (e && e.pointerId != null) thumb.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);

    // 點軌道空白處：視窗中心跳到點擊點
    track.addEventListener('pointerdown', function (e) {
      if (e.target === thumb) return;
      const leftPx = (e.clientX - track.getBoundingClientRect().left) - thumbWpx() / 2;
      Keyboard.setStartWhiteIndex(leftPxToStart(leftPx));
      sync();
      persist();
    });

    window.addEventListener('resize', sync);
    syncScroll = sync;   // 供改鍵數後重新同步拇指
    refreshers.push(sync);
    sync();
  }

  // ===== 節拍器 =====
  function initMetronome() {
    const $ = id => document.getElementById(id);
    const toggleBtn = $('metro-toggle');
    const bpmInput = $('bpm-input'), bpmDec = $('bpm-dec'), bpmInc = $('bpm-inc');
    const tapEl = $('tap');
    const tsNum = $('ts-num'), denBtn = $('den-cycle'), numDec = $('num-dec'), numInc = $('num-inc');
    const dots = $('beat-dots');

    function renderBpm() { bpmInput.value = String(Metronome.getBpm()); }
    function renderDots(n) {
      dots.innerHTML = '';
      for (let i = 0; i < n; i++) { const d = document.createElement('span'); d.className = 'dot'; dots.appendChild(d); }
    }
    function renderTs() {
      const ts = Metronome.getTimeSignature();
      tsNum.textContent = String(ts.numerator);
      denBtn.textContent = String(ts.denominator);
      renderDots(ts.numerator);
    }
    function renderToggle() {
      toggleBtn.textContent = Metronome.isRunning() ? '⏸' : '▶';
      toggleBtn.classList.toggle('on', Metronome.isRunning());
    }
    function highlight(index) {
      const ds = dots.querySelectorAll('.dot');
      for (let i = 0; i < ds.length; i++) ds[i].classList.toggle('active', i === index);
    }

    Metronome.init(highlight);        // onBeat(index,total) → 亮點
    renderBpm(); renderTs(); renderToggle();
    refreshers.push(function () { renderBpm(); renderTs(); renderToggle(); });

    toggleBtn.addEventListener('pointerdown', e => { e.preventDefault(); Metronome.toggle(); renderToggle(); if (!Metronome.isRunning()) highlight(-1); });
    bpmDec.addEventListener('pointerdown', e => { e.preventDefault(); Metronome.setBpm(Metronome.getBpm() - 1); renderBpm(); persist(); });
    bpmInc.addEventListener('pointerdown', e => { e.preventDefault(); Metronome.setBpm(Metronome.getBpm() + 1); renderBpm(); persist(); });
    bpmInput.addEventListener('change', () => { Metronome.setBpm(bpmInput.value); renderBpm(); persist(); });
    tapEl.addEventListener('pointerdown', e => { e.preventDefault(); const r = Metronome.tap(); if (r != null) { renderBpm(); persist(); } });
    numDec.addEventListener('pointerdown', e => { e.preventDefault(); const ts = Metronome.getTimeSignature(); Metronome.setTimeSignature(ts.numerator - 1, ts.denominator); renderTs(); persist(); });
    numInc.addEventListener('pointerdown', e => { e.preventDefault(); const ts = Metronome.getTimeSignature(); Metronome.setTimeSignature(ts.numerator + 1, ts.denominator); renderTs(); persist(); });
    denBtn.addEventListener('pointerdown', e => { e.preventDefault(); Metronome.cycleDenominator(); renderTs(); persist(); });
  }

  // ===== 主音量 =====
  function initVolume() {
    const input = document.getElementById('vol-input');
    const display = document.getElementById('vol-display');
    function render() {
      const pct = Math.round(AudioEngine.getMasterVolume() * 100);
      input.value = String(pct);
      display.textContent = String(pct);
    }
    render();
    refreshers.push(render);
    input.addEventListener('input', function () {
      AudioEngine.setMasterVolume(Number(input.value) / 100);
      display.textContent = input.value;
      persist();
    });
  }

  return { initA4, initKeys, initScrollbar, initMetronome, initVolume, loadAndApply };
})();

window.UI = UI;
