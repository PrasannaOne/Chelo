# Chelo Stage 3.8 engineering audit

## Scope

This pass reorganises the supplied Stage 3.7 package, applies the Chelo rebrand, fixes runtime/deployment wiring, removes stale packaging artifacts, and adds focused regression coverage. The recursive chess search, dual-perspective accumulator arithmetic and C36N model weights are otherwise preserved; the only search-loop source cleanup is removal of an uninitialised `ctx.deadline` comparison that was always false. The existing `fastBudget()` elapsed-time check remains authoritative.

## Issues found and fixed

1. **Main-thread fallback did not use Stage 3.7 NNUE.** The original page did not load `src/engine/fast-search.js` or `src/nnue/dual-nnue.js`, and the main thread did not load the dual model. If Worker startup failed, `brain.chooseMove()` used its legacy fallback. Stage 3.8 loads FastSearch and the parser before the app, fetches the dual model, verifies SHA-256, and installs the parsed model before creating the brain. The fallback now calls the same dual-NNUE FastSearch path and can use the locally loaded opening book.
2. **Worker paths were root-relative to the old flat layout.** The worker now imports modules from `../engine`, `../nnue`, and `../soul`, and fetches models/books from `../../models`. The app creates the Worker with a URL resolved against `document.baseURI`, which supports `/Chelo/` project-site hosting.
3. **Integrity verification was optional in the worker.** The previous worker skipped SHA verification if Web Crypto was unavailable. Stage 3.8 fails closed when SHA-256 cannot be computed and checks the same pinned hash as the main thread.
4. **Brand migration could strand local saves.** The app now copies the old `chessling_pet_1` save to `chelo_pet_1` when the new key is absent and checks both previous active-match keys. Old keys are not erased during migration.
5. **A root-loop deadline condition was dead code.** `ctx.deadline` was never initialised, so `now() >= ctx.deadline` could never be true. It was removed; node/time stopping remains in `fastBudget()`.
6. **Offline cache names/assets were stale.** The cache version is now `chelo-shell-v17-stage38`; the new source tree, models and manifest are precached, and activation deletes old Chessling and Chelo shell caches.
7. **Arena test/deployment references broke after reorganisation.** Worker imports, Wrangler names, schema defaults, test schema/migration paths and D1 configuration comments now match `workers/arena/`.

## Engine and data-structure checks

| Area | Validation | Result |
|---|---|---|
| Legal move generation | Start perft 20/400/8,902/197,281; Kiwipete 48/2,039/97,862; standard positions 3–6 | Pass |
| Special moves | En-passant, castling, promotion; 180 randomized make/unmake plies | Pass |
| Dual NNUE | 90 incremental plies and rollback parity; explicit en-passant/castling/promotion accumulator parity | Pass |
| V15 Soul | Bond/Arena rank-1/rank-2 tensor round-trip, full V15 import, old `Chessling Soul` V15 import | Pass |
| C36N binary | 49,368 bytes; C36N v1; 768 features; 32 hidden units; pinned SHA | Pass |
| Local TT collision | Direct-map index collision with distinct full keys | Correct miss/full-key verification |
| Shared TT race | Four threads, 50,000 writes each, same direct-map slot | 200,000 write attempts; zero corrupted successful probes; no worker hang |
| Search time budget | 20 ms requested, 10M node ceiling | Legal move returned in 20–21 ms |

The TT collision/race test intentionally allows misses when another writer owns or overwrites the same slot. It counts a corruption only if a successful probe returns a score or move inconsistent with the probed full key.

## Tactical retention

The bundled deterministic curriculum contains 50 unique legal mate-in-one positions. With book and policy disabled and an 8,000-node fixed budget, Stage 3.8 was compared directly with the original Stage 3.7 source: best move, score and node count were bit-identical on all 50 positions. The Stage 3.7 model found mate in one in 50/50 positions; the Stage 3.6 bootstrap reference also found 50/50. There were zero illegal moves and zero non-mating selections in this subset. The Stage 3.8-vs-Stage 3.7 record is `benchmarks/results/STAGE38-VS-STAGE37-50-MATE-TACTICAL.json`.

**Limit:** this data is a narrow mate-in-one retention set. No full Win At Chess, Eigenmann or Strategic Test Suite dataset is included in the supplied package, so this audit does not claim full WAC/Eigenmann/STS coverage or zero regressions across those suites.

## V8 / allocation audit

`node --trace-gc --trace-deopt tests/runtime-profile.js` was run after 12 warm-up searches in each of five Node.js V8 isolates (one main-thread harness isolate and four worker-thread isolates). Each measured window searched 30,000 nodes.

- In-window Scavenges: 0
- In-window other GC events: 0
- In-window deoptimizations: 0
- Median NPS: 119,048
- Mean NPS: 117,655

The trace is retained in `benchmarks/results/STAGE38-V8-PROFILE-TRACE.txt`; the summary is `benchmarks/results/STAGE38-V8-PROFILE.json`.

The recursive alpha-beta/quiescence path uses preallocated board/search typed buffers and does not create per-node move objects. Per-search fixed typed arrays and board buffers are still allocated once when a search begins. The engine's own result metadata continues to mark runtime allocation verification as false; this pass does not claim zero total allocations.

**Device limit:** these are Node.js V8 measurements in the available Linux container. No physical MediaTek/Snapdragon Android device or mobile Chromium remote-debugging session was available. Mobile thermal/NPS performance is not certified by this test.

## Active V14 compatibility, not dead code

`models/base-v14-float32.json` and V14-named pet-learning/LoRA routines remain active. The app loads that frozen base for the pet's separate learned value/policy model and for V15 Soul compatibility; it is not the Stage 3.7 C36N search evaluator. Removing it would break the current brain initialization and saved-pet compatibility. Stage 3.8 removes obsolete V14 search wiring from the browser fallback, not this active dependency.

## Deployment verification

- All browser asset URLs are relative to the repository base.
- Worker imports resolve relative to `src/worker/ai-worker.js`.
- Worker model fetches resolve to `models/` under the repository root.
- The service worker precache contains 20 existing assets.
- The runtime has zero external CDN script/style dependencies.
- GitHub Pages project subpaths work with relative paths; GitHub Pages cannot set COOP/COEP, so SharedArrayBuffer-dependent Apex falls back safely to one worker.
- Cloudflare Pages `_headers` supplies COOP/COEP for cross-origin isolation; Arena remains a separate D1-backed Worker.

## Release status

Stage 3.8 is a reorganised, regression-tested, ready-to-commit repository package. It is not an absolute Elo certification and is not a physical-device performance certification.
