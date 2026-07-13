// keyboard.js — M2：傳統鋼琴鍵盤（A1–C6 資料模型、可視視窗、渲染、pointerdown 發聲）
// 傳統佈局：白鍵滿高並排、黑鍵較窄疊於白鍵交界上方。
// 可視鍵數 = 白鍵數（單白鍵寬 = 容器寬 / 白鍵數）。+/− 與卷軸於 M3。
const Keyboard = (function () {
  'use strict';

  const RANGE_LOW = 33;         // A1
  const RANGE_HIGH = 84;        // C6
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
  const BLACK_RATIO = 0.62;     // 黑鍵寬相對白鍵寬

  let keys = [];                // 完整半音模型（A1–C6）
  let whiteKeys = [];           // 白鍵子集（依序）
  let whiteIndexByMidi = {};    // midi → whiteKeys 索引
  let container = null;
  const MIN_WHITE = 6, MAX_WHITE = 20;
  let visibleWhiteCount = 12;   // 預設可視白鍵數（6–20）
  let startWhiteIndex = 0;      // 可視視窗起點（whiteKeys 索引）
  const pressed = new Map();    // pointerId → 已按下的鍵元素（多點觸控正確復原）
  let slideMode = false;        // 滑動換音域模式（UI「滑動」切換;預設關）
  const slides = new Map();     // pointerId → { startX, startIndex }（滑動手勢錨點）
  let onWindowChange = null;    // cb()：滑動平移視窗後通知 UI（同步卷軸/八度 + persist）

  function buildModel() {
    keys = []; whiteKeys = []; whiteIndexByMidi = {};
    for (let midi = RANGE_LOW; midi <= RANGE_HIGH; midi++) {
      const pc = midi % 12;
      const isWhite = WHITE_PC.has(pc);
      const octave = Math.floor(midi / 12) - 1;              // 60→C4、69→A4、33→A1、84→C6
      const name = NOTE_NAMES[pc] + octave;
      const key = { midi, pc, isWhite, octave, name, label: isWhite ? name : '' };
      keys.push(key);
      if (isWhite) { whiteIndexByMidi[midi] = whiteKeys.length; whiteKeys.push(key); }
    }
    const c4 = whiteIndexByMidi[60];                          // 預設視窗自 C4 起
    startWhiteIndex = (c4 != null) ? c4 : 0;
    clampWindow();
  }

  function clampWindow() {
    const maxStart = Math.max(0, whiteKeys.length - visibleWhiteCount);
    startWhiteIndex = Math.min(maxStart, Math.max(0, startWhiteIndex));
  }

  function render() {
    if (!container) return;
    container.innerHTML = '';
    // 重繪前先收掉按住中的音，避免元素被移除後 release 配不到而殘響不止
    pressed.forEach(function (rec) {
      if (rec && rec.freqs) rec.freqs.forEach(function (f) { AudioEngine.noteOff(f); });
      if (rec && rec.midis) rec.midis.forEach(heldRemove);
    });
    pressed.clear();

    const whiteWidth = 100 / visibleWhiteCount;               // %
    const end = Math.min(whiteKeys.length, startWhiteIndex + visibleWhiteCount);
    const visibleWhites = whiteKeys.slice(startWhiteIndex, end);
    const visibleMidis = new Set(visibleWhites.map(k => k.midi));

    // 白鍵：等寬並排
    visibleWhites.forEach((k, j) => {
      const el = makeKey(k, 'white');
      el.style.left = (j * whiteWidth) + '%';
      el.style.width = whiteWidth + '%';
      container.appendChild(el);
    });

    // 黑鍵：夾在兩個「都可見」的白鍵之間，置於交界上方
    const blackWidth = whiteWidth * BLACK_RATIO;
    keys.forEach(k => {
      if (k.isWhite) return;
      const lower = k.midi - 1, upper = k.midi + 1;           // 黑鍵兩側必為白鍵
      if (visibleMidis.has(lower) && visibleMidis.has(upper)) {
        const jLower = whiteIndexByMidi[lower] - startWhiteIndex;
        const centerX = (jLower + 1) * whiteWidth;            // 下側白鍵右緣
        const el = makeKey(k, 'black');
        el.style.left = (centerX - blackWidth / 2) + '%';
        el.style.width = blackWidth + '%';
        container.appendChild(el);
      }
    });
  }

  function makeKey(k, cls) {
    const el = document.createElement('div');
    el.className = 'key ' + cls;
    el.dataset.midi = String(k.midi);
    if (k.label) {
      const lab = document.createElement('span');
      lab.className = 'key-label';
      lab.textContent = k.label;
      el.appendChild(lab);
    }
    el.addEventListener('pointerdown', onDown);
    return el;
  }

  // ===== 和弦模式 =====
  // 順階：鍵盤即為首調的音階（C4 鍵＝主音 do）;白鍵 pc → 該級數的三和弦半音距。
  // C:I 大、D:ii 小、E:iii 小、F:IV 大、G:V 大、A:vi 小、B:vii° 減。
  const DIATONIC = { 0:[0,4,7], 2:[0,3,7], 4:[0,3,7], 5:[0,4,7], 7:[0,4,7], 9:[0,3,7], 11:[0,3,6] };
  const MAJOR_TRIAD = [0, 4, 7];
  // 指定品質：按下的鍵為根音，疊出所選和弦
  const QUALITIES = {
    maj:   [0, 4, 7],
    min:   [0, 3, 7],
    dim:   [0, 3, 6],
    maj7:  [0, 4, 7, 11],
    dom7:  [0, 4, 7, 10],
    min7:  [0, 3, 7, 10],
    hdim7: [0, 3, 6, 10]
  };
  let chordMode = false;
  let chordQuality = 'diatonic';   // 'diatonic' | QUALITIES 之一

  function setChordMode(on) { chordMode = !!on; return chordMode; }
  function setChordQuality(q) {
    chordQuality = (q === 'diatonic' || QUALITIES[q]) ? q : 'diatonic';
    return chordQuality;
  }
  function isChordMode() { return chordMode; }
  function getChordQuality() { return chordQuality; }

  // 依模式算出這次按下要發的 midi 組（鍵盤空間;首調位移由 AudioEngine 套用）
  function chordMidis(midi) {
    if (!chordMode) return [midi];
    const intervals = (chordQuality === 'diatonic')
      ? (DIATONIC[midi % 12] || MAJOR_TRIAD)
      : QUALITIES[chordQuality];
    return intervals.map(function (iv) { return midi + iv; });
  }

  // ===== 按住音追蹤（供和弦辨識顯示） =====
  const held = new Map();          // midi → 按住計數（同鍵可被多指按）
  let onHeldChange = null;         // cb(sortedMidis[])：按住集合變動時通知

  function notifyHeld() {
    if (onHeldChange) onHeldChange(Array.from(held.keys()).sort(function (a, b) { return a - b; }));
  }
  function heldAdd(m) { held.set(m, (held.get(m) || 0) + 1); notifyHeld(); }
  function heldRemove(m) {
    const c = held.get(m);
    if (c == null) return;
    if (c <= 1) held.delete(m); else held.set(m, c - 1);
    notifyHeld();
  }

  function keyEl(midi) {
    return container ? container.querySelector('.key[data-midi="' + midi + '"]') : null;
  }

  function onDown(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const midi = Number(el.dataset.midi);
    const midis = chordMidis(midi);
    const freqs = [], els = [];
    midis.forEach(function (m) {
      const f = AudioEngine.noteOn(m);       // 按住持續發聲，放開才進 release
      if (f != null) freqs.push(f);
      heldAdd(m);                            // 供和弦辨識（含畫面外的音）
      const ke = keyEl(m);                   // 視覺顯示所有觸發的音（可視範圍內）
      if (ke) { ke.classList.add('active'); els.push(ke); }
    });
    pressed.set(e.pointerId, { els: els, freqs: freqs, midis: midis });
    if (slideMode) {
      // 滑動模式：記錨點供 onSlideMove;不 setPointerCapture —— 視窗平移會重繪並
      // 移除原鍵元素（capture 隨之失效），事件改由 document 層接手
      slides.set(e.pointerId, { startX: e.clientX, startIndex: startWhiteIndex });
    } else {
      try { if (e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  // 滑動換音域：按住琴鍵水平拖曳，以白鍵寬為步距平移可視視窗（錨點制，無漂移）。
  // 平移觸發的 render() 會先收掉所有按住音（既有防殘響邏輯），故滑動即自然停音。
  function onSlideMove(e) {
    if (!slideMode || !container) return;
    const st = slides.get(e.pointerId);
    if (!st) return;
    const whiteW = container.clientWidth / visibleWhiteCount;
    if (!(whiteW > 0)) return;
    const deltaKeys = Math.round((st.startX - e.clientX) / whiteW);  // 向左拖 → 看更高音域
    const target = Math.min(maxStart(), Math.max(0, st.startIndex + deltaKeys));
    if (target !== startWhiteIndex) {
      setStartWhiteIndex(target);
      if (onWindowChange) onWindowChange();
    }
  }

  function onRelease(e) {
    slides.delete(e.pointerId);          // 滑動錨點一律清除（pressed 可能已被重繪清掉）
    const rec = pressed.get(e.pointerId);
    if (!rec) return;
    rec.freqs.forEach(function (f) { AudioEngine.noteOff(f); });   // 放開才收音
    rec.midis.forEach(heldRemove);
    rec.els.forEach(function (el) { el.classList.remove('active'); });
    pressed.delete(e.pointerId);
    // 防卡音保險 1：最後一指離開時全域收音（此刻不該有任何持續聲部;
    // 可兜住 PolySynth 同音重疊 release 配對失敗的已知問題）
    if (pressed.size === 0) AudioEngine.releaseAll();
  }

  // 防卡音保險 2：強制釋放所有按住中的音（放開事件遺失、切離頁面時呼叫）
  function releaseAllPressed() {
    pressed.forEach(function (rec) {
      rec.freqs.forEach(function (f) { AudioEngine.noteOff(f); });
      rec.midis.forEach(heldRemove);
      rec.els.forEach(function (el) { el.classList.remove('active'); });
    });
    pressed.clear();
    slides.clear();
    AudioEngine.releaseAll();
  }

  // 滑動換音域模式開關（關閉時清掉進行中的滑動錨點）
  function setSlideMode(on) {
    slideMode = !!on;
    if (!slideMode) slides.clear();
    return slideMode;
  }
  function isSlideMode() { return slideMode; }

  // 改可視白鍵數（6–20 鉗制），保留左緣;鍵少→鍵變寬（render 內 100/count）
  function setVisibleWhiteCount(n) {
    n = Math.round(Number(n));
    visibleWhiteCount = Math.min(MAX_WHITE, Math.max(MIN_WHITE, Number.isFinite(n) ? n : visibleWhiteCount));
    clampWindow();
    render();
    return visibleWhiteCount;
  }

  // 移動可視視窗起點（whiteKeys 索引），鉗制在 [0, maxStart] 不出界
  function setStartWhiteIndex(i) {
    i = Math.round(Number(i));
    startWhiteIndex = Number.isFinite(i) ? i : startWhiteIndex;
    clampWindow();
    render();
    return startWhiteIndex;
  }

  // 上/下移一個八度（7 個白鍵），鉗制不出界
  function shiftOctave(delta) {
    return setStartWhiteIndex(startWhiteIndex + delta * 7);
  }

  // 目前可視視窗最左白鍵的科學音名（如 C4），供八度顯示
  function leftmostName() {
    const k = whiteKeys[startWhiteIndex];
    return k ? k.name : '';
  }

  function maxStart() { return Math.max(0, whiteKeys.length - visibleWhiteCount); }

  function initKeyboard(el) {
    container = el;
    buildModel();
    render();
    // 全域收放：放開處即使在鍵外/離開視窗也能復原對應鍵
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('pointercancel', onRelease);
    // 滑動換音域（slideMode 關閉時 onSlideMove 直接 return）
    document.addEventListener('pointermove', onSlideMove);
    // 切離頁面/失焦時強制收音（放開事件可能永遠不會來）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releaseAllPressed();
    });
    window.addEventListener('pagehide', releaseAllPressed);
    window.addEventListener('blur', releaseAllPressed);
  }

  return {
    initKeyboard,
    setVisibleWhiteCount, setStartWhiteIndex, shiftOctave,
    setChordMode, isChordMode, setChordQuality, getChordQuality,
    setSlideMode, isSlideMode,
    set onHeldChange(cb) { onHeldChange = cb; },
    set onWindowChange(cb) { onWindowChange = cb; },
    MIN_WHITE, MAX_WHITE,
    get leftmostName() { return leftmostName(); },
    get totalWhites() { return whiteKeys.length; },
    get maxStartWhiteIndex() { return maxStart(); },
    get visibleWhiteCount() { return visibleWhiteCount; },
    get startWhiteIndex() { return startWhiteIndex; },
    // 供測試/除錯
    get keys() { return keys; },
    get whiteKeys() { return whiteKeys; }
  };
})();

window.Keyboard = Keyboard;
