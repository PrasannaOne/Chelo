# Chelo V15-CPP Milestone 1 architecture

## Source baseline and frozen interfaces

Milestone 1 is based on `Chelo-V14-Stage3.10.zip`. The V37 C36N model remains 49,368 bytes with SHA-256 `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`. `src/soul/brain.js` and `src/app/app.js` are unchanged. V15 Soul serialization, the 50 KiB Free Soul storage limit, Bond_LoRA rank 1, and Arena_LoRA rank 2 remain owned by JavaScript.

## Evaluator contract

The C++ parser checks C36N magic/version/features/hidden/flags/divisor/reserved header fields. It reads the exact signed int8 feature matrices, signed int16 biases, signed int8 output weights, and signed int32 output bias. Perspective feature rows mirror black's rank (`square ^ 56`) and use the same piece-code convention as Stage 3.10. LoRA tensors are not model replacements: each adapter contributes a fixed-point hidden-bias delta, independently right-shifted and accumulated before int16 clamping. Both adapter buffers are supplied by the Worker. KPK and bare-king/mop-up handling are also ported.

## Search and storage

The core uses fixed-size storage, a 64-square mailbox synchronized with 12 piece bitboards and side/all occupancy bitboards, incremental make/unmake, and a four-way age-aware TT. TT entries survive move boundaries and `ucinewgame`; `clearhash` is the explicit reset. Search includes PVS, aspiration, killers, countermoves, two continuation-history contexts, gravity history with maluses, history-sensitive LMR, conservative LMP, NMP verification, check extensions, and check-evasion quiescence.

## Native and browser builds

`build_termux.sh` compiles `bin/chelo-uci` for the host Android/Termux architecture and a freestanding `wasm32` module. The core has no third-party dependencies, dynamic allocation, STL containers, exceptions, or filesystem calls. Native UCI uses the standard C++ library only in `uci_main.cpp`; WASM receives model/adapter/FEN buffers through a fixed-memory C ABI. The Worker loads `wasm/chelo.wasm` only when a caller explicitly sets `useCppEngine: true`; on any load/ABI/model/adapter/search failure it falls back to the existing JS search. Rated/PvP/companion fairness modes remain on the JS path for this milestone.

## Known limitations (do not overclaim)

- The C++ engine is a correctness-first Milestone 1 port, not yet a strength-validated replacement for Stage 3.10 or Stockfish. No gauntlets were run.
- C++ NNUE accumulators are currently recomputed from the board for evaluation; incremental accumulator frames are a high-priority performance improvement.
- The board keeps bitboards synchronized, but move generation still uses the 64-square mailbox scan; full bitboard move generation is future work.
- Native UCI currently supports `position`, `go depth`, `go movetime`, `ucinewgame`, and explicit `clearhash`; it is not yet a complete UCI option/time-control implementation.
- Search-strength tuning, full repetition adjudication, mate-score TT normalization, and broad tactical suites remain future validation/work items.

## Verification

Run `bash run-cpp-m1-tests.sh`. It compiles native and WASM targets, checks startpos perft 4 and Kiwipete perft 3, compares static evaluation with Stage 3.10 on five representative positions with non-zero Bond/Arena adapters, tests WASM search, and reruns V37/Soul integrity checks. `bash run-tests.sh` runs the existing JS repository/core tests.
