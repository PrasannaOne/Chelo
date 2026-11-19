# Deploying Chessling V4

## Local testing

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. HTTPS or localhost is recommended for reliable Worker and Service Worker behaviour.

## Static app: GitHub + Cloudflare Pages

1. Create a GitHub repository and upload the contents of the Chessling V4 folder to its root.
2. In Cloudflare, create a Pages project connected to that repository.
3. Select the production branch, choose the static/no-framework option, leave the build command empty and use `.` as the output directory.
4. Deploy and test the app on desktop and Android.
5. Test a human move, a Chessling reply, visible Practice Mode, pause/resume, hiding and returning to the tab, refresh/resume, and Soul export/import.

The service worker uses `chessling-shell-v6`. Increment this cache name whenever a cached app asset changes; its activation handler removes older Chessling shell caches.

## Optional Arena Worker

The Worker and D1 schema are in `arena/`. See `arena/README.md` for the database setup and deployment commands. The Worker is not connected to the local interface in this build. Its challenge endpoint stores legal games as unranked because target-side AI move attestation is not yet available. Do not treat those submissions as proof of pet strength or activate Arena Elo prematurely.

## Test suite

```bash
node tests/smoke.test.js
node tests/learning.test.js
node tests/worker.test.js
node arena/worker.test.mjs
```
