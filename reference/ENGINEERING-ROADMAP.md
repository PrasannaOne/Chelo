# Chelo Backend Engineering Roadmap

Backend-first. Do not expand the UI or claim strength gains before the data, engine and online fairness contracts are reliable.

## M1 — C++ migration foundation

Status: completed experimental foundation. Native C++20/UCI, freestanding WebAssembly, V37 evaluation, Bond/Arena adapter loading, perft gates and an opt-in Worker bridge are present. Not yet strength-validated for ranked play.

## M2 — Engine integrity and incremental evaluation

Status: implemented and sandbox-verified. Incremental Zobrist hashing and dual-perspective NNUE accumulator frames, SEE, bitboard attack optimisations, age-aware TT, rule-50/mate-score handling, repetition-aware search and deterministic fixed-node native/WASM parity are present.

## M3 — Search strength and predictable execution

Next engine milestone after the M4 save work is accepted. Priorities include search ordering/reduction tuning from telemetry, robust tactical/capture handling, additional bitboard move generation where it helps, complete UCI stop/time-control behaviour, and native ARM64/browser WASM measurements. Exit gates: tactical tests, fixed-node reproducibility, responsiveness and statistically meaningful paired games. No Elo claim from NPS alone.

## M4 — Unified player save and personal learning

Status: **implemented in source; local test gates pass. Not yet deployed or device-certified.**

- Retire individual `.soul` exports; create one `.chelo` per player.
- Enforce 100 KiB for the complete Free file; Pro holds five pets at up to 500 KiB each in one file.
- Keep player metadata once; store pet identity, traits, compact memories and quantised Bond/Arena adapters per pet.
- Remove old V14 learner tensors, per-pet legacy adapter, replay/opening compatibility payloads from the new portable record. Old `.soul` remains migration input only.
- Train the C++-consumed Bond/Arena adapters from controlled outcome feedback; keep Bond and Arena origins separate.
- Compress position keys to 64-bit fingerprints and game move history to two-byte move codes.
- Store the local collection in IndexedDB, then assemble one `.chelo` on export.
- Add authenticated `/api/player/save` routes and a SQLite-backed Durable Object storing one player record plus separate pet records. Use server-derived entitlement, owner identity checks and ETag concurrency.

Verified local gates: Free and five-pet Pro synthetic byte-budget tests; adapter update/round-trip tests; legacy import-only checks; DO split-record/ETag/entitlement tests; unchanged V37 checksum; existing native/WASM parity suite.

Remaining before production sync: deploy the Worker and DO migration with real Cloudflare resources; integrate account/login and sync actions in the app; validate the route through the real Cloudflare runtime; exercise realistic Android offline usage and long-game training; independently attest AI-side Arena moves before Arena outcomes automatically train pets.

## M5 — Engine strength upgrade

After M4 contract approval: benchmark search at fixed nodes/time, improve search strength without modifying V37 accidentally, compare native and WASM, then run statistically meaningful gauntlets. Pin engine/model/search/rules versions for any ranked use.

## M6 — Fair Arena

Add approved engine/model/rules metadata to matches; independent replay and pet-side move attestation; anti-farming limits; disconnect/draw/clock rules; and trusted Arena training-origin events. Unverified matches stay exhibitions.

## M7 — Product UI polish

Only after the backend, save contract, and competitive fairness are stable. Keep the board-first design, compact drawers/panels and the historical reference checklist constraints.
