// sw.js — Tunable Piano 離線 PWA Service Worker
//
// 策略：install 時把「程式 + 全部資源」precache 進 Cache Storage;之後 fetch 一律
// cache-first,同源請求命中快取直接回應、完全不碰網路。純前端無後端,離線無功能缺口。
//
// 關鍵坑(勿破壞)：
//  - 鋼琴取樣 24 檔 mp3 必須全數 precache,否則離線切鋼琴音色=無聲。
//  - Tone.js 已自帶於 js/vendor/(禁 CDN);跨源資源無法可靠 precache。
//  - 資產一律相對路徑(相容 GitHub Pages 子路徑);SW 以本檔所在目錄為 scope。
//  - addAll 為原子操作:任一資源 404 → 整個 install 失敗(fail-loud,寧可裝不成也不留半套)。
//
// 更新紀律(重要)：任何資產(js/css/html/mp3/圖示)變動,務必 bump 下方 CACHE 版本號,
// 否則舊 SW 會永遠供舊快取。bump 後 autoUpdate:下次連網載入自動換新、清舊 cache。

const CACHE = 'tunable-piano-precache-v2';

// 鋼琴取樣:每小三度一檔(A/C/Ds/Fs × 八度 1–6),共 24 檔
const PIANO = [];
['A', 'C', 'Ds', 'Fs'].forEach(function (n) {
  for (var o = 1; o <= 6; o++) PIANO.push('audio/piano/' + n + o + '.mp3');
});

const ASSETS = [
  './',                 // start_url(navigation 命中此鍵)
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/vendor/Tone.js',
  'js/audio.js',
  'js/keyboard.js',
  'js/metronome.js',
  'js/ui.js',
  'js/main.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
].concat(PIANO);

// install：整包 precache;成功後立即接手(skipWaiting → autoUpdate)
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

// activate：清掉舊版 cache,立即控管所有分頁
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// fetch：同源 cache-first;未命中走網路並回填快取;navigation 離線退回快取首頁
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;                       // 本站無非 GET,交給預設
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 跨源(理論上已無)交給網路

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') {
          return caches.match('index.html').then(function (r) {
            return r || caches.match('./');
          });
        }
        return Response.error();
      });
    })
  );
});
