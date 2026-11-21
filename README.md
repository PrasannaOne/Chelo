# Chelo V16-CPP · 256-Neuron Dual-NNUE + Natural Baby-to-GM Progression

Chelo is an offline-first, collectible chess-pet game. The shared C++20 chess engine and **V38 256-neuron Dual-NNUE** (`models/dual-nnue-v38-256.bin`, 394,776 bytes, SHA-256 `e14650d8f4ff79eb0197ab06fa7f6f370d53cc019289fde6f103e367db257826`) provide common chess capability; each pet develops its own identity, personality, trainer-specific Bond LoRA adapter (517 bytes), a separate Arena LoRA adapter (1,030 bytes) reserved for verified battles, and compact memories. **A player's only portable save is one `.chelo` file containing the complete player record and full pet roster.**

## V38 / M10 upgrades

- **256-neuron Dual-NNUE (`(768 -> 256) x 2 -> SCReLU -> 512 -> 1`):** Upgraded from 32 to 256 hidden units per perspective across C++ (`cpp/chelo_engine.hpp`, `cpp/chelo_engine.cpp`, `cpp/wasm_exports.cpp`, `cpp/uci_main.cpp`), JavaScript (`src/nnue/dual-nnue.js`, `src/engine/fast-search.js`, `src/soul/brain.js`), and `.chelo` / Cloudflare `PlayerSaveDO` adapter validation, with 64-bit accumulator sum overflow protection.
- **Natural baby-to-GM progression:** Game 0 remains a 100% pure hatchling (uniform random legal moves, 0% engine). After Game 0, growth speed follows the player's actual challenge rating, accepted Bond LoRA steps, and game experience—waking up quickly for strong players and staying gentle for casual players instead of unlocking at a fixed Game 12 wall.
- **Higher peak search ceiling & richer match memories:** Peak adaptive search scales smoothly from 500 nodes / 65 ms up to 750,000 nodes / 2,200 ms (depth 18), and episodic memories record real move counts and tactical strike counts.

---

Chelo is an offline-first, collectible chess-pet game. The shared C++ chess engine and V37 model provide common chess capability; each pet develops its own identity, personality, trainer-specific Bond learning, a separate Arena adapter reserved for verified battles, and compact memories. **A player's only portable save is one `.chelo` file containing the complete player record and full pet roster.** Individual `.soul` files are retired.

## Upload and install workflow

The repository accepts one root-level upload archive named `Chelo.zip`. Its contents must be rooted directly at the project root (for example, `index.html`, `cpp/`, `src/`, `models/`, `tests/`, and `docs/`, not an enclosing version-named folder). Upload or replace `Chelo.zip` in the repository root and the **Install Chelo project archive** workflow will validate its paths and required files, build/check the native engine, run the core engine regression suite, prepare a static-site artifact, and then copy project files into the repository root. The archive is the complete application source of truth: installation removes stale application/project files that are absent from the archive, while preserving `.git/`, `.github/` workflow definitions, and the uploaded `Chelo.zip`. GitHub Actions workflow files are managed separately and are deliberately not overwritten by the archive installer because the default Actions token cannot update workflow files. GitHub Pages deployment remains managed by the repository Pages configuration.

For manual local checks, see `M8-ANDROID-QUICKSTART.md` and run `bash run-m8-engine-tests.sh` on a compatible Clang/Node environment. Android users should use `bash build_termux.sh` in Termux and then `./bin/chelo-uci --verify`.

## M9: true hatchling progression and draw guardrails

A pet with zero completed trainer games now chooses uniformly from legal moves only. It does not use the V37 evaluator, C++ search, policy head or opening book to choose its first-game moves. Across games 1–11, simple material awareness and position/move memory are introduced gradually; V37 search begins blending in at game 12 and reaches full selection only after sustained play. At four to five completed matches, Chelo should notice material and immediate piece danger but still make frequent mistakes. These stages are behavioural design targets, not certified Elo levels.

Bond LoRA now learns from same-position tactical counterfactuals rather than treating the final game winner as a label for every position. It mines difficult positive-capture versus immediate-hang contrasts, applies bounded importance-weighted Int8 updates, and keeps an update only when held-back parent positions improve. Accepted Bond deltas already influence the developmental move selector; full V37 search still phases in from game 12. See `docs/BOND-LORA-LEARNING.md` and run `node tests/lora-milestone-benchmark.test.js` for the three-run 5/10/25/50-game benchmark. Immediate recaptures also give position/move-specific memory feedback.

Casual single-player games automatically claim threefold-repetition and 50-move draws to stop shuffle loops. Under FIDE rules those two are claimable rather than automatic; fivefold repetition and the 75-move rule are automatic, with checkmate taking precedence. See `docs/DEVELOPMENTAL-LEARNING-AND-DRAW-RULES.md`.

## M8: native search correctness and efficiency hardening

M8 keeps the M7 bitboard generator and frozen V37 model, while correcting search-behaviour regressions found by comparing the C++ port with Stage 3.9. It bounds in-check quiescence, removes duplicate check extensions, restores the Stage 3.9 null-move and LMR schedules, prevents path-sensitive TT score reuse, restores repetition handling through null branches, preserves the best root move without relying on a path-sensitive TT entry, fixes legal-en-passant position identity, and detects insufficient material in both main and quiescence search. The transposition table now retains 262,144 entries in four-way buckets. Native and WASM builds pass the same deterministic evaluation/search checks.

M8 has **not** yet established an absolute Elo or proved a tournament-strength gain over Stage 3.9. Same-host diagnostics show higher completed search depth in most sampled positions, but move choices differ and Android-device measurements plus a longer paired match remain outstanding. See `docs/CPP-M8-ENGINE-RELEASE.md` and `M8-ANDROID-QUICKSTART.md`.

## M7: bitboard engine and tactical-search upgrade

M7 upgrades the native C++/WASM engine with ray-mask bitboard move generation, deeper quiescence, conservative SEE/delta pruning, and soft/hard time management. Native UCI now supports clock controls and the Termux runner can benchmark the actual Android device or run colour-swapped Elo gauntlets against another UCI engine. The frozen V37 model and `.chelo` save format are unchanged. See `docs/CPP-M7-ENGINE-RELEASE.md` for results and `M7-TERMUX-QUICKSTART.md` for phone-side build, benchmark and Elo instructions.

## M6: C++/V37-first adaptive companion

M6 promotes the C++/WASM engine from an optional diagnostic path to the search engine for local adaptive companion games. M9 now gates its move selection behind developmental stages, so a fresh hatchling does not use that strong search from its first game. The Worker verifies and loads the pinned V37 model, loads the pet's Bond/Arena adapters, and runs a bounded C++ search. Both the personal node budget and time budget are enforced. If WebAssembly is unavailable, a visible JavaScript safety fallback remains available.

Completed trainer games now leave compact persistent event memories, and personality descriptions reflect combinations of the pet's evolving traits. The most recent memory appears in the growing-brain panel and travels inside the existing V16 `.chelo` pet record extension.

**Arena integrity remains deliberately strict:** the current server proves that submitted games are legal, not that the opponent pet produced the submitted moves. Such exhibitions do not train Arena. Trainer tactical contrasts update Bond only. Game outcomes inform memories and challenge calibration rather than directly training the evaluator. Server-verifiable AI-move attestation is still needed before Arena battles can safely feed Arena learning.

The internal adaptive challenge estimate is not a certified Elo. M6 validates the budget curve and integration, not human-skill calibration or an Elo gain. M7 adds reproducible native-device benchmarking and relative UCI Elo tools; M8 hardens the C++ search path; real Android measurements and a full external-engine gauntlet must still be collected on the target device.

See `docs/CPP-M6-RELEASE-REPORT.md` for scope, evidence, and remaining boundaries. The M5 documentation below records the baseline this milestone extends.

---

## M5 baseline: adaptive companion and unified `.chelo` storage

M4 introduced the unified portable save; M5 raises the Free capacity while retaining the same compact player-owned data model:

| Budget | Free | Pro |
|---|---:|---:|
| One complete `.chelo` file | 100 KiB maximum | 5 × 500 KiB pet payloads + shared metadata, approximately 2.45 MiB / 2.57 MB decimal |
| Pet slots | 1 | 5 |
| Per-pet data ceiling | 97 KiB | 500 KiB |
| Shared player metadata | 2 KiB maximum | 2 KiB maximum |

The Free file limit applies to the whole exported file, including the player header, active-match snapshot, roster, JSON envelope and checksum. We reserve 97 KiB for its one pet and 2 KiB for shared player data; final validation checks the actual complete 100 KiB ceiling. Each Pro pet receives its own 500 KiB allowance inside the same file. The five pet payloads are not five separate downloads.

The `.chelo` file uses a versioned, minified JSON container (`CHELO` v1) with a CRC32 corruption check. Pet records use compact numeric arrays, 64-bit position fingerprints, packed 16-bit UCI moves, and quantised Int8 Bond/Arena adapters. The CRC is an integrity check, not an authentication signature. Online account identity and Pro entitlement are checked by the server, not trusted from the file.

The shared C++ engine, V37 weights, opening book, KPK data, app code and static assets stay hosted once. They are never embedded in the `.chelo` file. Legacy `.soul` files may be accepted by the migration-only importer, but Chelo no longer exports or creates them.

### M5 synthetic storage measurements

The current deterministic stress fixtures measure:

| Fixture | Complete file | Retained distinct position fingerprints |
|---|---:|---:|
| Free | 98,800 bytes / 102,400 | 2,188 |
| Pro, per pet | 511,215 bytes / 512,000 | 11,398 |
| Pro, five pets | 2,556,439 bytes / 2,568,192 | 5 × 11,398 |

These counts come from deterministic synthetic distinct-position fixtures. They are not a promise that every real pet will retain exactly that many memories or that every memory is a separately playable game. Real training, long-session growth and Android storage behaviour still need device validation. A fresh Free test file is about 716 bytes, before the player has built up much history.

M4 first connected trainer-game outcome feedback to Bond; the M10 learner supersedes that noisy update rule with same-position tactical counterfactuals, bounded LoRA updates and held-out validation. M6 makes the C++ V37 adapter-aware evaluator the default for local adaptive companion play. Trainer games update Bond only. Online Arena exhibitions remain unranked and are not fed into Arena learning because the server currently verifies legal replay, not AI move authorship. The V37 model remains immutable.

See:
- `reference/CHELO-SAVE-FORMAT.md` for the complete save contract.
- `docs/CPP-M6-RELEASE-REPORT.md` for current M6 behaviour and validation.
- `docs/CPP-M5-RELEASE-REPORT.md` for historical M5 storage measurements.
- `docs/CHELO-MIGRATION.md` for legacy import behaviour.

## Shared model and engine assets

M6 leaves the shared V37 model weights frozen while extending the C++ search bridge with simultaneous time and node limits. The chess evaluation weights are not retrained or changed.

- `models/dual-nnue-v37.bin`: **49,368 bytes**, SHA-256 `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`.
- `cpp/chelo_engine.hpp` / `cpp/chelo_engine.cpp`: fixed-storage C++20 chess core, incremental position/hash/NNUE state and search.
- `cpp/uci_main.cpp`: native UCI engine.
- `cpp/wasm_exports.cpp` / `wasm/chelo.wasm`: browser Worker bridge.
- `build_termux.sh`: native Clang++ Android/Termux build. `build_wasm.sh`: separate freestanding WASM build.

In M5, the optional C++ Worker bridge was still opt-in and adaptive matches used JavaScript FastSearch. M6 supersedes that behaviour: mature local adaptive matches use C++/V37 search, subject to the M9 developmental gate and an explicit JavaScript safety fallback. The 300–2,400 challenge number remains an internal estimate, not a calibrated Elo rating.

## Cloudflare storage design

The Arena Worker exposes authenticated `GET/PUT /api/player/save` endpoints. A SQLite-backed Durable Object stores the player header and each pet as separate records, then assembles the single `.chelo` file at the API boundary. This avoids putting the full five-pet file into one DO key/value item or SQL row. Writes use ETags so a stale device cannot silently overwrite a newer save. The Worker derives the account plan from D1 and passes authenticated account identity to the save object; a client-edited `plan` field cannot grant Pro storage.

The backend code and local Durable Object tests are included, but **the Worker has not been deployed and the app does not yet have its account/login/cloud-sync interface wired in**. Deployment still requires a real D1 database ID, a Pages origin, Wrangler authentication, and the `PlayerSaveDO` migration. Offline game and local `.chelo` import/export remain usable without Arena services.

Cloudflare's current Free plan supports SQLite-backed Durable Objects, with 100,000 DO requests/day, 13,000 GB-seconds/day, and 5 GB account storage; key+value and SQL row/BLOB limits are 2 MB. The 500 KiB per-pet records fit individually, while the whole Pro file is split across records. Worker request body limits are much larger than the `.chelo` cap. These are platform ceilings, not a guarantee of unlimited free sync: request/compute/storage quotas still apply. See the official [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Repository layout

```text
index.html / assets/         Offline-first board UI and styles
src/app/                     Player app and unified .chelo workflow
src/soul/brain.js             Individual pet memory and Bond/Arena learning
src/soul/chelo-save.js        CHELO v1 container, limits and IndexedDB storage
src/nnue/                     Shared V37 parser
src/worker/                   Browser search Worker and C++-first adaptive bridge
cpp/ / wasm/                  Shared native/WASM chess engine
models/                       Shared model and static chess resources
workers/arena/                Cloudflare Worker, PlayerSaveDO and D1 schema
reference/                    Canonical product and engineering plans
docs/                         Release, migration and validation reports
tests/                         Save-format, learning, engine and Worker tests
```

## Build and verify

```sh
bash build_termux.sh
./bin/chelo-uci --verify
bash build_wasm.sh
bash run-m8-engine-tests.sh
bash run-tests.sh
bash run-learning-tests.sh
bash run-nnue-tests.sh
bash run-search-tests.sh
bash run-tactical-tests.sh
bash run-worker-tests.sh
bash run-m6-tests.sh  # Full build + validation bundle (long-running)
```

On an Android device, `bash benchmarks/termux-benchmark.sh` measures native search throughput. After hosting the repository, open `benchmarks/wasm-device-benchmark.html` on Android Chrome/WebView to measure WASM. Compare against another UCI engine with `./run-termux-elo.sh /path/to/opponent-uci 60 500`; the result is relative Elo difference, not an absolute rating. `build-static.sh` creates `_site/` for Cloudflare Pages or GitHub Pages. The app has no frontend bundler and no runtime CDN dependency.

## Adaptive companion

New and never-calibrated pets begin at a conservative internal challenge setting of 100, with a 500-node / 65 ms / depth-1 starter search. Perfect Polyglot opening-book moves are withheld until the internal challenge setting reaches 800. Completed trainer games gradually adjust the challenge budget. This private dial is not measured Elo, and the strength curve still needs real-player calibration.