# Chelo V14 engine-core hardening

Date: 2026-11-19

This change set is limited to engine/search runtime code, worker asset loading, engine tests, benchmark artifacts, and documentation. It does not change UI layout, game progression, the frozen V14 model checkpoint, or the existing Soul serialization format.

## Frozen model integrity

- Checkpoint: `models/base-v14-float32.json`
- SHA-256 (Stage 3.8 metadata-rebranded checkpoint): `233bab4845b047e884007ed1dfec805acea94511a26d94e2154c8656f4f1b863`
- Stage 3.8 keeps one canonical copy in `models/`; duplicate research copies were removed from the release package. Only the display `format` metadata was rebranded; the frozen tensor arrays and `baseVersion` are unchanged.

## Polyglot hashing and opening book

- Standard 781-entry Polyglot Zobrist key set is bundled in `src/engine/polyglot-random.js` as paired `Uint32Array` high/low words; the hot path does not require `BigInt`.
- Polyglot hashes are shared by the opening-book lookup and transposition table. The initial-position reference hash is `463b96181691fc9c`.
- `models/polyglot-book.bin` contains 1,280 sorted, unique 16-byte Polyglot records, total **20,480 bytes**. The record uses big-endian fields: 8-byte key, 2-byte move, 2-byte weight, 4-byte learn value.
- Lookup uses lower-bound binary search over unsigned high/low key pairs. A verified book move returns before tree search (`nodes: 0`).
- Every bundled record was tested against its manifest FEN: hash, encoded move, and legal-move match all pass.
- The book is a deterministic starter repertoire generated from legal opening rollouts with simple center/development preferences. It is not a curated expert or tournament opening book.

## Incremental neural input accumulator

- The first-layer pre-activation is retained as a `Float32Array(48)` for each side-to-move perspective, alongside the compact active feature vector.
- Search make/unmake updates only affected piece squares (from, to, capture, en-passant victim, and castling rook squares), plus position-state flags. Promotion is represented by the piece code on the destination square.
- An undo delta restores the exact feature codes and reverses the accumulated weight deltas during recursive backtracking.
- The recursive search uses in-place push/pop; the standalone clone helper remains available for tests.
- Randomized legal-play checks and explicit en-passant, castling, promotion, and nested two-ply make/unmake checks agree with full recomputation within the asserted Float32 tolerance.

## Typed transposition table

The direct-mapped TT contains **262,144 entries**, using typed arrays for:

- `keyHi` and `keyLo`: both 32-bit words are verified on probe.
- `depth`: signed 8-bit search depth.
- `flag`: EXACT, ALPHA, or BETA bound.
- `score`: signed 16-bit search score with mate distance normalized on store and restored for the probing ply.
- `bestMove`: packed hash move for internal and root move ordering.
- `generation`: replacement-age bookkeeping.

## Search changes

- Iterative deepening and alpha-beta/negamax with principal-variation search.
- TT hash move first, MVV-LVA captures/promotions, two killer moves, and history ordering.
- Quiescence search extends captures/promotions; when in check it searches legal evasions rather than stand-pat.
- Null-move pruning uses R=2 and is disabled in check, at PV nodes, on consecutive nulls, and when neither side has non-pawn material (king-and-pawn-only endings).
- Late Move Reductions apply to later quiet moves; any reduced-depth fail-high receives a full-depth re-search before it can affect the principal line.

## Benchmark results

See `benchmarks/ENGINE-HARDENING-REPORT.md` and `benchmarks/engine-hardening-benchmark-results.json`.

- NPS comparison: same frozen model and held-out positions, 150 ms per search, book disabled, full first-layer recomputation versus incremental accumulator.
- Median depth at 150 ms: reported for both paths.
- Held-out tactical positions follow the Lichess puzzle convention: apply `moves[0]` to the source FEN, then search the resulting puzzle position against `moves[1]`.
- Tactical hit rates are exact first-solution-move agreement, not complete proof of every possible mating line. A separate 600 ms forced-mate sample reports strict mate-score plus expected-move solves.
- Results are Node.js local measurements, not browser/mobile/thermal guarantees.

## Preservation checks

- The V14 adapter encoder/decoder, compact Soul representation, Soul export and Soul import blocks are unchanged relative to the supplied V14 deployment source.
- Existing V13/V14 Soul compatibility and learning regression tests pass.
- UI layout and game progression were not changed as part of this hardening.


## Follow-up scalar/endgame pass (2026-11-19)

See `docs/V14-FINAL-PASS-REPORT.md` for the exact scope and benchmark. The search now uses a scalar-only value-head path and skips policy priors in interior nodes; root policy ordering remains enabled. A material-gated king-corner mop-up bonus was added, and repetition adjudication uses the standard threefold threshold. Zero-allocation packed move generation and a dedicated Zobrist repetition-count table were **not** implemented in this pass; the report explicitly records these remaining tasks.
