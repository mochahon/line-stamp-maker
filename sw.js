/* Service Worker — offline support for the Stamp Maker.
 * Bump VERSION when app files change; old caches are cleaned on activate.
 * Project data lives in IndexedDB and is never touched by cache updates. */
var VERSION = 'v1';
var STATIC_CACHE = 'stamp-maker-static-' + VERSION;
var FONT_CACHE = 'stamp-maker-fonts-' + VERSION;

var APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/zip.js',
  'js/db.js',
  'js/editor.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== STATIC_CACHE && k !== FONT_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Google Fonts: cache-first so text fonts keep working offline after
  // the first successful load.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONT_CACHE).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          var network = fetch(e.request).then(function (res) {
            if (res && (res.status === 200 || res.type === 'opaque')) cache.put(e.request, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || network;
        });
      })
    );
    return;
  }

  // Same-origin app files: cache-first, falling back to network, and
  // navigations fall back to the cached index for offline launches.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (res) {
          var copy = res.clone();
          caches.open(STATIC_CACHE).then(function (cache) { cache.put(e.request, copy); });
          return res;
        }).catch(function () {
          if (e.request.mode === 'navigate') return caches.match('index.html');
          throw new Error('offline');
        });
      })
    );
  }
});
