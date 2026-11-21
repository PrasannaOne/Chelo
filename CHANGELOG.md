## M8 - Native search correctness and efficiency hardening

- Bounded in-check quiescence to the Stage 3.9 safety horizon and restored the original five-ply quiescence start.
- Removed the C++ port's duplicate/extra check extensions; restored the Stage 3.9 R2/R3 null-move reduction schedule and late-move reduction thresholds.
- Added repetition-aware TT cutoff/store suppression, retained repetition-disabled state throughout null-move descendants, added root draw protection, and decoupled root best-move retention from TT storage for path-sensitive positions.
- Corrected Zobrist en-passant identity to include only legally capturable en-passant targets, including pinned-pawn cases.
- Added fast insufficient-material draw recognition in main search and quiescence.
- Expanded the transposition table to 262,144 entries in four-way buckets; compacted bounded history storage and replaced a full-board null-move material scan with bitboard checks.
- Added detailed UCI timeout diagnostics, FEN/ply tracing, per-engine Move Overhead=0 for fair timed gauntlets, and M8 UCI identity.
- Rebuilt and verified both native and WebAssembly engines; added regression tests for rule-50/repetition-sensitive root moves; V37 weights and `.chelo` save data remain unchanged.
- Same-host M7/M8 diagnostics show deeper completed search in most test positions, but no absolute Elo or Android performance claim is made.

## M7 - Native/WASM engine strength and device benchmarks

- Replaced slider ray walking with precomputed bitboard ray attacks and leaper masks; retained deterministic attack/SEE parity checks.
- Extended quiescence to 8 plies, added conservative SEE/delta pruning, and preserved checking sacrifices.
- Added a root mate-in-one preflight, soft/hard time control separation, and native UCI clock support.
- Added a native Android/Termux benchmark, browser/WebView WASM benchmark, and paired-colour UCI Elo runner.
- Verified six perft positions, 50/50 native mate-in-one retention, native/WASM fixed-node parity, and managed-time search.
- V37 weights and `.chelo` save format remain unchanged.

# Changelog

## M6 - C++/V37-first Companion + Episodic Personality
- Made C++/WASM + pinned V37 + per-pet Bond/Arena adapters the default for local adaptive games.
- Added simultaneous node/time-bounded C++ search and explicit JavaScript fallback telemetry.
- Added compact persistent event memories and richer trait-combination personality descriptions.
- Restricted trainer reinforcement to Bond; un-attested online Arena exhibitions cannot train Arena.
- Kept V37 weights and the `.chelo` Free/Pro storage contract unchanged.

# Changelog

## M5 - Adaptive Companion
- Increased Free .chelo cap to 100 KiB; Pro remains five 500 KiB pets.
- Added trainer-responsive adaptive challenge and personalised casual search budgets.
- Updated Cloudflare save validation and tests.

# Chelo V15-CPP · Milestone 4 changelog

## One player, one `.chelo`
- Retired independent `.soul` export files; the sole portable save is one `player.chelo` with shared player data and the entire pet roster.
- Enforced a 50 KiB complete-file ceiling for Free and up to five Pro pet records of 500 KiB each in one file (2,500 KiB plus shared metadata/container allowance).
- Stored player identity/settings/active match once. Added `activePetId` so import restores the pet that was active at export time.
- Kept game code, C++ engine, WASM, V37 weights, opening book and static resources outside the portable save.

## Compact learning payload
- New pet record v16 stores only compact identity/progression, traits, Bond/Arena Int8 adapters, memory rows, pending outcome references and mastery metadata.
- Removed the legacy V14 learner tensors, retired old adapter and replay/opening tables from new portable payloads.
- Replaced repeated position FEN strings in ordinary memory rows with 64-bit fingerprints; retained packed position information for unresolved outcomes.
- Encoded saved UCI move history in two bytes per half-move.
- Connected trainer outcome feedback to the Bond adapter and added explicit Arena-layer reinforcement. Practice-only outcomes do not update adapters.

## Local and Cloudflare storage
- Added IndexedDB player and per-pet records; export/import assembles or restores the single complete `.chelo`.
- Added authenticated `/api/player/save` GET/PUT routes and a SQLite-backed `PlayerSaveDO` that stores the player header and each pet separately.
- Added account ID/handle ownership validation, server-derived plan limits, CRC validation, ETags, and stale-write protection (HTTP 409/428).
- Retired per-pet `/api/pets/:handle/sync` with HTTP 410. Legacy SQL brain columns remain dormant for non-destructive schema compatibility.

## M4 verification
- Free synthetic fixture: 47,622 / 51,200 bytes, 1,045 distinct position fingerprints retained (47 KiB pet budget plus shared player metadata).
- Pro synthetic fixture: 2,556,399 / 2,568,192 bytes, five pet records of 511,207 bytes each, 11,398 distinct fingerprints per pet (500 KiB per pet).
- Fresh test Free `.chelo`: 708 bytes. Shared player metadata budget: 2 KiB.
- Bond and Arena training/serialization tests, model immutability, import migration, tamper/entitlement checks and Worker/DO split-record/ETag tests pass.
- V37 model hash and native/WASM engine parity remain unchanged. No Elo improvement is claimed.
- Cloudflare resources have not been deployed; app account/login/cloud-sync UI and real-device validation remain outstanding.

---

# Chelo V15-CPP · Milestone 3 changelog

## Exact historical `.soul` file-size enforcement
- Fixed the old V15 `.soul` exporter to emit minified JSON and measure the actual complete UTF-8 file.
- Added a deterministic synthetic size audit and historical UI reference checklist.
- Historical M3 measurements: Free 50,509 / 51,200 bytes (143 synthetic positions); Pro 501,853 / 512,000 bytes (5,129 synthetic positions). This was superseded by the M4 `.chelo` container.

---

# Chelo V15-CPP · Milestone 2 changelog

## Engine integrity and performance foundation
- Added incremental 64-bit Zobrist updates and dual-perspective NNUE accumulator frames with parity checks.
- Added least-valuable-attacker SEE with x-ray discovery; retained a slow reference for parity.
- Added bitboard leaper/king attack masks, side-piece iteration, age-aware TT, rule-50/mate-score handling, repetition-aware search, telemetry and deterministic fixed-node search.
- Kept the C++ Worker bridge opt-in and the model baseline frozen.

## M2 verification
- Startpos perft 4: 197,281; Kiwipete perft 3: 97,862.
- Seven-position Stage 3.10 static-evaluation parity with non-zero adapters.
- Incremental NNUE/hash parity including castle, en-passant and promotion.
- Native/WASM fixed-node parity in the sandbox. No Elo claim; no physical Android benchmark.

## Repository packaging update

- Standardised the upload artifact as a root-layout `Chelo.zip` independent of milestone/version directory names.
- Reworked the repository installer to validate archive paths and required M8 engine files, build and test the native engine, prepare a static-site artifact, and replace the repository project tree from the validated archive using `rsync --delete`, while preserving Git metadata and the uploaded archive.
- Kept Pages deployment separate from archive installation; Pages now builds the WASM artifact before static-site preparation.
