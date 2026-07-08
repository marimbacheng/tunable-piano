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

    // 解鎖後組裝各模組（需在 Tone.start() 之後）
    AudioEngine.init();
    UI.initA4();
    Keyboard.initKeyboard(document.getElementById('keyboard'));
    UI.initKeys();
    UI.initScrollbar();

    unlockEl.hidden = true;
    appEl.hidden = false;
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
