/* Chelo offline shell. Relative paths resolve under the deployed repository subpath. */
const CACHE_NAME = 'chelo-shell-v25-stage15cpp-m8-search-hardening';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/style.css', './assets/icon.svg', './assets/pieces.svg',
  './src/app/app.js', './src/engine/polyglot-random.js', './src/engine/chess.js',
  './src/engine/endgame-kpk.js', './src/engine/fast-search.js', './src/nnue/dual-nnue.js',
  './src/soul/chelo-save.js', './src/soul/brain.js', './src/worker/ai-worker.js', './wasm/chelo.wasm',
  './models/base-v14-float32.json', './models/polyglot-book.bin', './models/dual-nnue-v37.bin',
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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(CACHE_NAME)).put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
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
});
