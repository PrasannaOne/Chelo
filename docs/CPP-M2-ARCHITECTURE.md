# Chelo V15-CPP M2 architecture

## Scope

M2 advances the M1 native C++20/WASM port without changing the JavaScript Soul or app. The implementation baseline remains `Chelo-V15-CPP-M1`; M1 is retained separately for comparison. No user interface redesign is part of this milestone.

## Engine layers

1. **Position state:** a 64-square mailbox is synchronized with per-piece bitboards and side/all occupancy. Side pieces are now iterated using ascending set-bit extraction, preserving original source-square ordering. Sliding rays still use the mailbox reference implementation; M2 is not yet a fully bitboard-generated move engine.
2. **Incremental state:** deterministic Zobrist keys cover pieces, side, castling rights and en-passant file. `make()` updates the hash and the `Undo` record restores it. `verifyHash()` recomputes from the board for diagnostic parity.
3. **V37 evaluator:** the model parser retains the C36N layout and fixed-point arithmetic. White and black accumulator frames are maintained per ply. Feature add/remove updates preserve the Stage 3.10 feature row, black-perspective square mirror, adapter bias shift, int16 clamp sequence and final integer rounding. A full board rebuild remains available as a reference verifier.
4. **Adapters:** Bond rank 1 and Arena rank 2 remain independent binary buffers. Their fixed-point hidden-bias deltas layer onto V37; they do not replace or retrain the shared weights.
5. **Search:** PVS, iterative deepening, aspiration windows, four-way age-aware TT, two killers, countermoves, two-ply continuation history, gravity history with maluses, history-guided LMR, conservative LMP, null-move verification, check extensions and quiescence are retained. Quiescence handles legal check evasions and does not stand pat in check.
6. **Repetition path:** each ply records whether its path hash belongs to a real game/search path. Artificial null-move nodes are marked invalid for repetition comparison, while a same-position NMP verification search can still perform repetition checks. Game history is reset by `setFen` and recorded by `playUciMove`.
7. **TT lifecycle:** entries persist across ordinary `position`/move/search boundaries. `ucinewgame` and `clearhash` explicitly clear the table. The four-way set uses age/depth replacement; full 64-bit keys are checked. Rule-50 context gates score cutoffs, while stored moves can still assist ordering. Mate scores are normalized for ply on store/probe.

## Native and WebAssembly

`cpp/chelo_engine.cpp` is the fixed-storage engine core. Native UCI wrappers use standard C++ facilities in `cpp/uci_main.cpp`; the freestanding WASM wrapper receives model, KPK, adapter and FEN data from JavaScript through fixed-memory buffers. `chelo_search_nodes` exposes the deterministic node-budget profile; both main-search and qsearch visits count against the same budget.

The Worker bridge remains opt-in and retains JavaScript fallback. The current `src/worker/ai-worker.js`, `src/app/app.js` and `src/soul/brain.js` files are unchanged from M1. The long-term architecture remains C++ as the canonical chess engine, with JavaScript owning Soul identity, personality/memories, progression and application orchestration. The actual Soul-to-engine personality policy integration is future work.

## Verification contract

- Perft: startpos depth 4 = 197,281; Kiwipete depth 3 = 97,862.
- Static score parity with Stage 3.10 on seven reference FENs using non-zero Bond and Arena adapter buffers.
- Incremental accumulator parity with full recomputation over legal playouts and explicit castling, en-passant and promotion transitions.
- Incremental hash round-trip parity.
- Optimized SEE versus the retained slow reference over 160 deterministic playout plies.
- Optimized attack detector versus mailbox reference over 160 playout plies.
- Threefold repetition and 50-move draw checks.
- Deterministic 30,000-node search repeatability and bit-identical native/WASM result in the sandbox test.

These gates establish implementation parity and repeatability, not Elo. Physical Android ARM64 and actual browser-device validation remain outstanding.
