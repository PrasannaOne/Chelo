/* Chelo offline shell. Network-first for app UI/scripts so Brave/Chrome always pick up updates immediately; cache-first for immutable models. */
const CACHE_NAME = 'chelo-shell-v40-juiced-search-and-pacing';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/style.css', './assets/icon.svg', './assets/pieces.svg',
  './src/app/app.js', './src/engine/polyglot-random.js', './src/engine/chess.js',
  './src/engine/endgame-kpk.js', './src/engine/fast-search.js', './src/nnue/dual-nnue.js',
  './src/soul/chelo-save.js', './src/soul/brain.js', './src/worker/ai-worker.js', './wasm/chelo.wasm',
  './models/base-v14-float32.json', './models/polyglot-book.bin', './models/dual-nnue-v38-256.bin',
  './models/kpk-wdl.bin', './models/kpk-wdl-manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => (key.startsWith('chessling-shell-') || key.startsWith('chelo-shell-')) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isImmutableModel(pathname) {
  return pathname.endsWith('.bin') || pathname.endsWith('base-v14-float32.json');
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Heavy immutable binary models: cache-first for instant loads.
  if (isImmutableModel(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  // HTML, JS, CSS, SVG, WASM: network-first so Brave/Chrome always get fresh updates, falling back to cache offline.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: 'no-cache' });
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request.mode === 'navigate' ? './index.html' : request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request.mode === 'navigate' ? './index.html' : request);
      return cached || Response.error();
    }
  })());
});
