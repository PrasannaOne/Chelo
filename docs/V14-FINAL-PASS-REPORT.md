# Chelo V14 final speed/endgame pass: implementation report

Date: 2026-11-19

## Scope and preservation

This pass changes only `src/soul/brain.js`, the engine-hardening test, the test runner, and engine documentation/benchmark artifacts. The browser deployment copy of `src/soul/brain.js` is kept in sync. No UI, game-progression, adapter, or Soul serialization code was changed.

Frozen checkpoint SHA-256 (before and after): `309fe09cf69f41efb5f0faaba47b63543c420c2b1098684dbd8f6e9e90be6d28`.
The Stage 3.8 repository retains one canonical pet-learning checkpoint at `models/base-v14-float32.json`; duplicate research copies were removed. `models/polyglot-book.bin` remains 20,480 bytes.

## Implemented safely

1. **Scalar search evaluation:** added `forwardValueFromAccumulator()`, which computes the scalar value from the frozen value head without constructing the full WDL result object. A regression assertion compares it against the full forward pass for both perspectives.
2. **Lazy policy use:** interior alpha-beta nodes no longer request policy priors. Root ordering still uses policy priors; quiescence ordering already used the non-policy path. This avoids running the 4,096-action policy head through the interior tree.
3. **Endgame mop-up:** added a small material-gated bonus for driving the losing king toward the board edge while bringing the winning king closer.
4. **Draw threshold:** search now recognizes the standard threefold repetition threshold rather than waiting for five occurrences. Existing path-sensitive TT protection remains active when a position has already repeated.

## Explicitly not completed

- **Zero-allocation move generation / packed 32-bit move lists:** not implemented. The current `ChessCore.moves({verbose:true})` API returns newly allocated move objects/arrays, and recursive make/unmake still consumes UCI move objects. Replacing this safely requires a coordinated move-generator and board-state API refactor, plus dedicated perft and special-move validation. This pass does not claim allocation-free search.
- **Dedicated game-history Zobrist repetition table and twofold-in-search policy:** not implemented. The current position-history representation is retained; no new Zobrist repetition-count map was introduced. The threefold rule and existing TT path-sensitivity are the only repetition changes.
- **Fully allocation-free make/unmake:** not implemented. The existing incremental Float32 accumulator and reversible restore path remain in place, but their delta bookkeeping still allocates.

These items are intentionally disclosed rather than represented as completed optimisations.

## Verification

- `bash run-tests.sh`: exit code 0. Core smoke, perft, learning, engine, new hardening, worker, arena and SQL schema tests passed.
- `node tests/engine-hardening.test.js`: passed. Polyglot start hash `463b96181691fc9c`; TT size 262,144; 20 KiB / 1,280-entry book validated; randomized accumulator and special-move restoration checks passed; search returned a legal move.
- The test runner's environment emitted a non-fatal optional spreadsheet-runtime warmup traceback after the successful test output.
- The Lichess benchmark correctly applies `moves[0]` to the source FEN and compares the engine move against `moves[1]`.

## Re-benchmark

150 ms local Node.js benchmark, book disabled:

| Metric | Result |
|---|---:|
| Median NPS, full recompute path | 11,424 |
| Median NPS, incremental accumulator path | 12,530 |
| Median depth, incremental path | 1.5 |
| Mate-in-2 exact first-move hits | 11/20 (55.0%) |
| Mate-in-3 exact first-move hits | 5/20 (25.0%) |
| Mate-in-2 strict 600 ms proofs | 7/10 |
| Mate-in-3 strict 600 ms proofs | 4/10 |

The new benchmark's median depth is 1.5, below the previous report's depth 2. The higher NPS therefore must not be presented as an unqualified strength improvement. Tactical hit rates match the previous reported 55% / 25%; forced-mate proof counts remain 7/10 and 4/10. These are local Node.js measurements, not mobile/browser thermal guarantees.

## Conclusion

This is a tested, conservative scalar-evaluation / lazy-policy / mop-up update, **not completion of the requested zero-allocation + Zobrist repetition hardening**. The ZIP and report label that boundary explicitly.
