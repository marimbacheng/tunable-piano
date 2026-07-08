// main.js — M0：手勢解鎖 + 橫向偵測
// 模組組裝與各功能綁定於後續里程碑加入。
(function () {
  'use strict';

  const unlockEl = document.getElementById('unlock');
  const unlockBtn = document.getElementById('unlock-btn');
  const rotateEl = document.getElementById('rotate');
  const appEl = document.getElementById('app');

  // ===== 手勢解鎖 AudioContext =====
  let unlocked = false;

  async function unlock() {
    if (unlocked) return;      // 旗標防重入：pointerdown 與 click 只會實際跑一次
    unlocked = true;
    try {
      await Tone.start();      // 必須在使用者手勢內呼叫
    } catch (err) {
      unlocked = false;        // 失敗則允許再試
      console.error('[unlock] Tone.start() 失敗:', err);
      return;
    }
    console.log('[unlock] AudioContext state =', Tone.getContext().state);

    // 音訊引擎（不需 DOM）
    AudioEngine.init();

    // 先顯示主畫面，讓容器有版面尺寸（卷軸 sync 需正確 clientWidth，否則量到 0）
    unlockEl.hidden = true;
    appEl.hidden = false;

    // 再組裝需量測/渲染 DOM 的模組
    UI.initA4();
    Keyboard.initKeyboard(document.getElementById('keyboard'));
    UI.initKeys();
    UI.initScrollbar();
    UI.initMetronome();
    UI.initVolume();
    UI.loadAndApply();      // 套用 localStorage 已存設定並刷新所有 UI
  }

  // pointerdown 為主（低延遲），click 為桌機/後備；旗標確保單次執行
  unlockBtn.addEventListener('pointerdown', unlock);
  unlockBtn.addEventListener('click', unlock);

  // ===== 橫向偵測 =====
  // 需求：偵測到直向 → 蓋全螢幕提示；橫向自動移除。與解鎖狀態無關。
  const portraitMQ = window.matchMedia('(orientation: portrait)');

  function updateOrientation() {
    rotateEl.hidden = !portraitMQ.matches;
  }

  // matchMedia change 為主（iOS 較可靠）
  if (typeof portraitMQ.addEventListener === 'function') {
    portraitMQ.addEventListener('change', updateOrientation);
  } else if (typeof portraitMQ.addListener === 'function') {
    portraitMQ.addListener(updateOrientation);   // 舊版 Safari 後備
  }
  // 後備事件
  window.addEventListener('orientationchange', updateOrientation);
  window.addEventListener('resize', updateOrientation);

  // 初始判定
  updateOrientation();
})();
