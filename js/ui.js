// ui.js — M1：A4 基準音控制列（數字輸入 + −/＋ + 常見值快捷）
// 步進 1 Hz、範圍 415–445（鉗制）；改值即套用到 AudioEngine。
// BPM/鍵數/卷軸/localStorage 於後續里程碑加入。
const UI = (function () {
  'use strict';

  let a4Input = null;
  let a4Display = null;

  function apply(hz) {
    const clamped = AudioEngine.setA4(hz);
    render(clamped);
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

  return { initA4 };
})();

window.UI = UI;
