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

  function onDown(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const midi = Number(el.dataset.midi);
    AudioEngine.playNote(midi);                               // 一律 pointerdown 發聲
    el.classList.add('active');                               // 按下變色
    pressed.set(e.pointerId, el);
    try { if (e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onRelease(e) {
    const el = pressed.get(e.pointerId);
    if (el) { el.classList.remove('active'); pressed.delete(e.pointerId); }  // 放開即復原
  }

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

  function maxStart() { return Math.max(0, whiteKeys.length - visibleWhiteCount); }

  function initKeyboard(el) {
    container = el;
    buildModel();
    render();
    // 全域收放：放開處即使在鍵外/離開視窗也能復原對應鍵
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('pointercancel', onRelease);
  }

  return {
    initKeyboard,
    setVisibleWhiteCount, setStartWhiteIndex,
    MIN_WHITE, MAX_WHITE,
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
