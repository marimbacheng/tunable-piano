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
          transpose: AudioEngine.getTranspose(),
          theme: currentTheme,
          bpm: Metronome.getBpm(),
          num: ts.numerator,
          den: ts.denominator,
          whiteCount: Keyboard.visibleWhiteCount,
          startWhite: Keyboard.startWhiteIndex,
          slide: Keyboard.isSlideMode(),
          custom: customColors
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
    if (s.transpose != null) AudioEngine.setTranspose(s.transpose);
    if (s.custom && hexRgb(s.custom.kb) && hexRgb(s.custom.bg) && hexRgb(s.custom.accent)) {
      customColors = { kb: s.custom.kb, bg: s.custom.bg, accent: s.custom.accent };
    }
    if (s.theme != null) applyTheme(s.theme);   // custom 需在自訂色載入後套用
    if (s.bpm != null) Metronome.setBpm(s.bpm);
    if (s.num != null && s.den != null) Metronome.setTimeSignature(s.num, s.den);
    if (s.whiteCount != null) Keyboard.setVisibleWhiteCount(s.whiteCount);
    if (s.startWhite != null) Keyboard.setStartWhiteIndex(s.startWhite);
    if (s.slide != null) Keyboard.setSlideMode(!!s.slide);
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
    a4Display = document.getElementById('a4-display');   // 已移除;render 內有 null 防護
    const dec = document.getElementById('a4-dec');
    const inc = document.getElementById('a4-inc');

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

    // 常見值快速選擇（415/432/440/442）
    document.querySelectorAll('.a4-preset').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        apply(btn.dataset.hz);
      });
    });
  }

  // ===== 可視白鍵數 +/− =====
  let keysDisplay = null;
  let syncScroll = null;   // 由 initScrollbar 設定
  let syncOctave = null;   // 由 initOctave 設定

  // 視窗位置改變後，同步卷軸拇指與八度顯示
  function refreshWindow() {
    if (syncScroll) syncScroll();
    if (syncOctave) syncOctave();
  }

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
      refreshWindow();
      persist();
    });
    inc.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      Keyboard.setVisibleWhiteCount(Keyboard.visibleWhiteCount + 1);
      renderKeys();
      refreshWindow();
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
      // 絲滑拖曳：拇指連續跟手（不量化），鍵盤視窗只在索引真的變了才重繪
      const travel = trackW() - thumbWpx();
      const leftPx = Math.min(travel, Math.max(0, (e.clientX - track.getBoundingClientRect().left) - grabDX));
      thumb.style.left = (leftPx / trackW() * 100) + '%';
      const newStart = leftPxToStart(leftPx);
      if (newStart !== Keyboard.startWhiteIndex) {
        Keyboard.setStartWhiteIndex(newStart);
        if (syncOctave) syncOctave();     // 只更新八度顯示，不動拇指（保持跟手）
        persist();
      }
    });
    const end = function (e) {
      if (!dragging) return;
      dragging = false;
      try { if (e && e.pointerId != null) thumb.releasePointerCapture(e.pointerId); } catch (_) {}
      sync();                              // 放手後把拇指吸附到量化位置
    };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);

    // 點軌道空白處：視窗中心跳到點擊點
    track.addEventListener('pointerdown', function (e) {
      if (e.target === thumb) return;
      const leftPx = (e.clientX - track.getBoundingClientRect().left) - thumbWpx() / 2;
      Keyboard.setStartWhiteIndex(leftPxToStart(leftPx));
      refreshWindow();
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

  // ===== 首調（C4 鍵實際發出的音;顯示如「+2 D」） =====
  const PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  function initTranspose() {
    const dec = document.getElementById('tr-dec');
    const inc = document.getElementById('tr-inc');
    const display = document.getElementById('tr-display');
    function render() {
      const t = AudioEngine.getTranspose();
      const name = PC_NAMES[((60 + t) % 12 + 12) % 12];   // C4 鍵實際發出的音名
      display.textContent = (t > 0 ? '+' : '') + t + ' ' + name;
    }
    render();
    refreshers.push(render);
    dec.addEventListener('pointerdown', function (e) { e.preventDefault(); AudioEngine.setTranspose(AudioEngine.getTranspose() - 1); render(); persist(); });
    inc.addEventListener('pointerdown', function (e) { e.preventDefault(); AudioEngine.setTranspose(AudioEngine.getTranspose() + 1); render(); persist(); });
  }

  // ===== 和弦模式（順階/指定品質）+ 和弦辨識顯示 =====
  // 辨識模板：相對根音的半音集合 → 和弦代號後綴
  const CHORD_TEMPLATES = {
    '0,4,7': '',        // Major
    '0,3,7': 'm',       // Minor
    '0,3,6': 'dim',     // Diminished
    '0,4,8': 'aug',     // Augmented（順手支援）
    '0,4,7,11': 'M7',   // Major 7
    '0,4,7,10': '7',    // Dominant 7
    '0,3,7,10': 'm7',   // Minor 7
    '0,3,6,10': 'ø7',   // Half-Diminished 7
    '0,3,6,9': 'dim7'   // Diminished 7（順手支援）
  };

  // 依實際發聲音高辨識（含首調位移）;由低到高逐一嘗試根音,涵蓋轉位
  function recognizeChord(keyboardMidis) {
    const t = AudioEngine.getTranspose();
    const sounded = keyboardMidis.map(function (m) { return m + t; });
    const pcs = [];                       // 唯一 pc,依實際音高低→高排序
    sounded.forEach(function (m) {
      const pc = ((m % 12) + 12) % 12;
      if (pcs.indexOf(pc) < 0) pcs.push(pc);
    });
    if (pcs.length < 3) return null;
    for (let i = 0; i < pcs.length; i++) {
      const root = pcs[i];
      const rel = pcs.map(function (p) { return (p - root + 12) % 12; }).sort(function (a, b) { return a - b; });
      const suffix = CHORD_TEMPLATES[rel.join(',')];
      if (suffix !== undefined) return PC_NAMES[root] + suffix;
    }
    return null;
  }

  function initChord() {
    const toggle = document.getElementById('chord-toggle');
    const display = document.getElementById('chord-display');
    toggle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      const on = Keyboard.setChordMode(!Keyboard.isChordMode());
      toggle.classList.toggle('on', on);
    });
    // 品質選擇：順階 or 指定品質（單選）
    const quals = document.querySelectorAll('.qual');
    quals.forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        Keyboard.setChordQuality(btn.dataset.q);
        quals.forEach(function (b) { b.classList.toggle('on', b === btn); });
      });
    });
    // 和弦辨識：按住集合變動即重算（同時涵蓋和弦模式與手動按的多音）
    Keyboard.onHeldChange = function (midis) {
      const name = recognizeChord(midis);
      display.textContent = name || '—';
      display.classList.toggle('lit', !!name);
    };
  }

  // ===== 主題 =====
  let currentTheme = 'classic';

  // 自訂主題三色（鍵盤/背景/啟動）;其餘配色由亮度衍生。預設 = 經典配色起手
  let customColors = { kb: '#1b1b22', bg: '#1a1a1f', accent: '#4caf50' };

  // --- 顏色工具（hex 混色/明暗/亮度） ---
  function hexRgb(h) {
    h = String(h).replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbHex(r, g, b) {
    function c(v) { return ('0' + Math.round(Math.min(255, Math.max(0, v))).toString(16)).slice(-2); }
    return '#' + c(r) + c(g) + c(b);
  }
  function mix(h1, h2, t) {           // h1 → h2 線性混色,t∈[0,1]
    const a = hexRgb(h1), b = hexRgb(h2);
    if (!a || !b) return h1;
    return rgbHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  function lighten(h, t) { return mix(h, '#ffffff', t); }
  function darken(h, t) { return mix(h, '#000000', t); }
  function lum(h) {                   // 感知亮度 0–1
    const c = hexRgb(h);
    return c ? (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 : 0;
  }

  // 三色 → 完整 --c-* 變數組（依背景/鍵盤/啟動色亮度自動選深淺與文字色）
  function deriveCustomVars(c) {
    const bgLight = lum(c.bg) > 0.5;
    const text = bgLight ? '#3a3540' : '#eaeaea';
    const kbLight = lum(c.kb) > 0.55;
    return {
      '--c-bg': c.bg,
      '--c-text': text,
      '--c-panel': bgLight ? darken(c.bg, 0.04) : lighten(c.bg, 0.05),
      '--c-panel-border': bgLight ? darken(c.bg, 0.14) : lighten(c.bg, 0.14),
      '--c-label': mix(text, c.bg, 0.35),
      '--c-btn': bgLight ? darken(c.bg, 0.08) : lighten(c.bg, 0.10),
      '--c-btn-border': bgLight ? darken(c.bg, 0.22) : lighten(c.bg, 0.22),
      '--c-input': bgLight ? '#ffffff' : darken(c.bg, 0.30),
      '--c-kb-well': bgLight ? darken(c.bg, 0.12) : darken(c.bg, 0.45),
      '--c-dim': mix(text, c.bg, 0.60),
      '--c-thumb': mix(c.accent, bgLight ? darken(c.bg, 0.10) : lighten(c.bg, 0.10), 0.45),
      '--c-bk': c.kb,
      '--c-bk-active': kbLight ? darken(c.kb, 0.18) : lighten(c.kb, 0.28),
      '--c-bk-border': darken(c.kb, 0.30),
      '--c-wk-active': mix('#ffffff', c.kb, 0.22),          // 白鍵按下:染一點鍵盤色
      '--c-wk-border': mix('#ffffff', c.kb, 0.40),
      '--c-wk-label': kbLight ? darken(c.kb, 0.45) : c.kb,  // 白鍵字:深化的鍵盤色（白底可讀）
      '--c-accent': c.accent,
      '--c-accent-border': darken(c.accent, 0.25),
      '--c-accent-text': lum(c.accent) > 0.55 ? '#222428' : '#ffffff'
    };
  }

  function applyCustomVars() {
    const vars = deriveCustomVars(customColors);
    for (const k in vars) document.body.style.setProperty(k, vars[k]);
  }

  function applyTheme(name) {
    if (['classic', 'gray', 'pink', 'custom'].indexOf(name) < 0) name = 'classic';
    currentTheme = name;
    document.body.classList.remove('theme-gray', 'theme-pink', 'theme-custom');
    if (name !== 'classic') document.body.classList.add('theme-' + name);
    if (name === 'custom') applyCustomVars();
    document.querySelectorAll('.swatch').forEach(function (b) {
      b.classList.toggle('on', b.dataset.theme === name);
    });
    const cc = document.getElementById('custom-colors');
    if (cc) cc.hidden = (name !== 'custom');   // 三色選擇器只在自訂主題顯示
  }

  function initTheme() {
    document.querySelectorAll('.swatch').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        applyTheme(btn.dataset.theme);
        persist();
      });
    });
    // 三色選擇器：改色即時套用（input 連續觸發,persist 已去抖）
    const pickers = { kb: 'cc-kb', bg: 'cc-bg', accent: 'cc-accent' };
    function syncPickers() {
      for (const key in pickers) {
        const el = document.getElementById(pickers[key]);
        if (el) el.value = customColors[key];
      }
    }
    for (const key in pickers) {
      (function (k) {
        const el = document.getElementById(pickers[k]);
        el.addEventListener('input', function () {
          if (hexRgb(el.value)) customColors[k] = el.value;
          applyTheme('custom');
          persist();
        });
      })(key);
    }
    refreshers.push(syncPickers);
    syncPickers();
    applyTheme(currentTheme);
  }

  // ===== 八度切換（◀/▶ 移動可視視窗一個八度；與卷軸共享視窗狀態） =====
  function initOctave() {
    const dec = document.getElementById('oct-dec');
    const inc = document.getElementById('oct-inc');
    const display = document.getElementById('oct-display');
    function render() { display.textContent = Keyboard.leftmostName; }
    render();
    syncOctave = render;              // 卷軸/鍵數變動時一併更新
    refreshers.push(render);
    dec.addEventListener('pointerdown', function (e) { e.preventDefault(); Keyboard.shiftOctave(-1); refreshWindow(); persist(); });
    inc.addEventListener('pointerdown', function (e) { e.preventDefault(); Keyboard.shiftOctave(1); refreshWindow(); persist(); });
  }

  // ===== 滑動換音域（按住琴鍵水平拖曳平移可視視窗;預設關） =====
  function initSlide() {
    const btn = document.getElementById('slide-toggle');
    function render() { btn.classList.toggle('on', Keyboard.isSlideMode()); }
    render();
    refreshers.push(render);
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      Keyboard.setSlideMode(!Keyboard.isSlideMode());
      render();
      persist();
    });
    // 滑動平移視窗後：同步卷軸拇指/八度顯示 + 保存位置
    Keyboard.onWindowChange = function () { refreshWindow(); persist(); };
  }

  return { initA4, initKeys, initScrollbar, initMetronome, initOctave, initTranspose, initChord, initTheme, initSlide, loadAndApply };
})();

window.UI = UI;
