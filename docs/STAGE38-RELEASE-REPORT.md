# Chelo V14 · Stage 3.8 engineering release report

**Package:** `Chelo-V14-Stage3.8.zip`  
**Status:** Ready-to-commit engineering package; mobile-device and broad tactical certification remain outstanding.

## Product and repository

The product is now branded **Chelo** across the visible interface, HTML title/meta, web manifest, service-worker cache namespace, worker header, Arena Worker deployment name, current comments and current documentation. The repository is organised around `src/app`, `src/engine`, `src/nnue`, `src/soul`, `src/worker`, `models`, `workers/arena`, `tests`, `benchmarks` and `docs`.

New Souls export with Chelo labels. The importer continues to accept old Chessling V15 full-Soul and Bond/Arena LoRA labels, prior V13/V14 Soul versions, and the old runtime-global/localStorage aliases. This is intentional backward compatibility, not active product branding.

## Model identity

- `models/dual-nnue-v37.bin`: 49,368 bytes
- C36N v1, 768 features, 32 hidden units per perspective
- SHA-256: `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`
- The main-thread fallback and AI Worker both verify the same hash before parsing.

The V14-named Float32 checkpoint is retained as the pet's separate active learning base. It is not the Stage 3.7 search NNUE and cannot be removed without changing the pet-learning model and Soul compatibility.

## Bugs fixed

1. Browser fallback previously omitted the fast search and dual-NNUE parser scripts and did not load the dual model. It could silently run the legacy fallback when Worker creation failed. Stage 3.8 loads the search/parser scripts and verified C36N model before creating the pet brain; fallback now uses the same dual-NNUE FastSearch path.
2. AI Worker URL construction and import/fetch paths assumed the old flat root layout. All paths now resolve relative to the repository/document or worker URL, including GitHub Pages project subpaths.
3. Worker model integrity checking previously skipped SHA-256 when Web Crypto was absent. Both main and worker loaders now fail closed.
4. Old browser pet saves could be missed after the brand migration. The app copies `chessling_pet_1` to `chelo_pet_1` if required and checks previous active-match keys.
5. `now() >= ctx.deadline` was a dead root-loop condition because `ctx.deadline` was never initialised. It has been removed; the existing `fastBudget()` elapsed-time check still stops timed search.
6. Old PWA cache entries and flat-layout precache paths were stale. Cache versioning and activation cleanup now cover old Chessling and Chelo cache prefixes; all runtime modules/models are precached.
7. Arena Worker imports, Wrangler naming, D1 defaults and test/migration paths now match `workers/arena/`.

## Test results

All test groups passed when run through their dedicated scripts:

- Core/repository: `run-tests.sh`
- Search and board: `run-search-tests.sh`
- C36N and V15 Soul: `run-nnue-tests.sh`
- AI Worker/Arena/D1: `run-worker-tests.sh`
- TT/tactical/time budget: `run-tactical-tests.sh`
- Learning/migration: `run-learning-tests.sh`
- V8 profiling: `run-v8-profile.sh`

Highlights:

- Standard perft: start position through depth 4 (197,281); Kiwipete through depth 3 (97,862); positions 3–6.
- En-passant, castling and promotion; 180 randomized make/unmake plies; 90 dual-accumulator incremental/undo plies.
- V15 Bond/Arena LoRA standalone/full Soul import parity, including an old `Chessling Soul` V15 fixture.
- Shared TT direct-map collision and 4-thread contention test: 200,000 write attempts, zero corrupted successful probes, no hung worker.
- 50/50 mate-in-one retention on both Stage 3.7 and Stage 3.6 bootstrap at 8,000 nodes per position; Stage 3.8 also matched original Stage 3.7 best move, score and node count bit-identically on all 50 positions.
- 20 ms timed-search guard returned a legal move in 20–21 ms in this environment.
- Five warmed Node V8 isolates, 30,000 nodes each: zero in-window Scavenges, other GC events and deoptimizations; median NPS 119,048.
- No runtime CDN dependency; all 20 service-worker precache entries exist; project-subpath URL resolution passes.

## Explicit limits

- The tactical set is 50 mate-in-one positions, not full WAC, Eigenmann or STS coverage.
- V8 measurements are Node.js isolates in the build container, not physical MediaTek/Snapdragon Android devices or mobile Chromium.
- The recursive search hot path uses preallocated typed buffers, but per-search typed scratch buffers are allocated once per search. The engine's own `runtimeAllocationVerified` remains false; no zero-total-allocation claim is made.
- GitHub Pages cannot set COOP/COEP headers; SharedArrayBuffer-dependent Apex falls back to one worker there. Cloudflare Pages applies the included `_headers` policy.
- Cloudflare Arena deployment still requires the operator's D1 database ID and production CORS origin in `workers/arena/wrangler.toml`.

Stage 3.8 is a clean, deployable repository reorganisation and bug-fix pass, not a claim of absolute 3,050+ Elo or mobile-device certification.
