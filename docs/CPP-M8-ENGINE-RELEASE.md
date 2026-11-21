# Chelo V15-CPP M8: Search Correctness and Efficiency Hardening

## Executive assessment

M8 is a corrective engine milestone built directly on M7. It preserves the M7 bitboard move generator and V37 NNUE, but repairs several search-behaviour differences found when the M7 C++ source was compared with the Stage 3.9 JavaScript baseline.

The most consequential M7 issue was unbounded quiescence check-evasion search. M7 started quiescence at depth 8 but only enforced its depth stop outside check. Check-evasion chains could therefore continue until the global search-ply ceiling. The old JavaScript implementation started quiescence at 5 and stopped check-evasion continuation at `qDepth <= -6`. M8 restores those bounds.

M8 also removes the C++ port's double check-extension behaviour, restores the Stage 3.9 null-move and LMR schedules, restores path-sensitive TT protections, fixes en-passant position identity, and recognises insufficient-material draws in both normal and quiescence search.

**M8 is better verified and searches deeper in the supplied same-host diagnostic suite. It has not yet earned an Elo claim.** The fixed-position tests are not a substitute for a sufficiently long paired self-play or external-engine tournament.

## Scope and invariants

Only the C++ engine, its native UCI harness, engine-specific tests, benchmark labels, and service-worker cache version were changed.

Unchanged:

- `models/dual-nnue-v37.bin` and its SHA-256.
- The V14 base checkpoint.
- Bond/Arena adapter binary formats.
- `.chelo` save format and pet-learning code.
- The chess UI and progression systems.
- The browser-facing WASM ABI.

V37 remains **49,368 bytes**, SHA-256:

`f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`

## Source-level corrections

### 1. Bounded quiescence search

M7 used a starting quiescence depth of 8. Its check branch did not apply a corresponding depth stop, which allowed check-evasion sequences to continue far beyond the nominal horizon.

M8:

- Restores the Stage 3.9 starting quiescence depth of 5.
- Stops in-check quiescence at `qDepth <= -6`, matching the previous JS safety bound.
- Continues to generate all legal evasions while in check.
- Detects checkmate before applying the quiescence horizon.
- Checks rule-50, insufficient-material and repetition draws in quiescence.
- Preserves promotions and avoids pruning a losing-looking capture when it gives check.

This prevents the qsearch horizon from becoming effectively unbounded during checking sequences.

### 2. Removed duplicate check extensions

M7 extended depth when entering a checked node and also extended the child depth when a move gave check. A checking sequence could therefore receive repeated/double extensions.

M8 removes those extra C++ extensions and restores the Stage 3.9 search-depth semantics. A future extension policy should be introduced only with dedicated tactical-suite and match evidence.

### 3. Restored null-move reduction schedule

M7 used R1 below depth 6 and R2 at depth 6 or above. Stage 3.9 used R2 below depth 6 and R3 at depth 6 or above.

M8 restores:

- R2 below depth 6.
- R3 at depth 6 and above.
- Verification search at depth 6 and above.
- No null move when in check, in a null subtree, or at a halfmove clock of 90 or greater.
- Repetition remains disabled throughout all descendants of a null move.

The non-pawn-material check now uses the piece bitboards rather than scanning all 64 board squares.

### 4. Restored the Stage 3.9 LMR thresholds

M8 restores the baseline late-move reduction schedule:

- Quiet, non-check moves only.
- Start reductions at the fourth searched legal move and depth 3.
- Use a one-ply reduction by default.
- Use a two-ply reduction only from depth 6 and the ninth searched legal move onward.

This replaces M7's more aggressive history-driven reduction schedule for this baseline-correction release. Further history-sensitive LMR tuning should be measured independently.

### 5. Path-sensitive transposition-table protection

M8 suppresses TT score cutoffs and TT storage when the search context is path-sensitive:

- Null-move subtree.
- Halfmove clock at or above 90.
- Current position has already appeared earlier in the relevant game/search path.

A matching TT move can still be used for move ordering; the position's score is not reused as a path-independent result.

This restores the important protection present in Stage 3.9 and avoids treating repetition- or rule-50-sensitive nodes as ordinary transpositions.

### 6. Correct repetition propagation

M8 preserves the `allowRepetition` state when recursively entering descendants. A null-move subtree cannot accidentally re-enable repetition accounting deeper in the same null subtree.

An open-addressed exact 64-bit repetition index accelerates game-history lookups. The search path is checked separately. Repetition state is rebuilt when FEN/history is reset or history rolls over.

### 7. Correct en-passant position identity

M7 included every raw FEN en-passant target in its Zobrist hash. That can distinguish positions even when no legal en-passant capture exists.

M8 hashes an en-passant file only if at least one legal en-passant capture exists. It checks king exposure after the hypothetical capture, so a pinned pawn cannot make an illegal capture affect position identity.

Tests cover:

- An en-passant target with no capturing pawn.
- A legal en-passant capture.
- An en-passant capture that would expose the king.

### 8. Insufficient-material detection

M8 adds a bitboard-based insufficient-material check to main search and quiescence search, using the same classifications as the Stage 3.9 JS baseline:

- Bare kings: draw.
- King and one minor versus king: draw.
- Bishops-only positions where all bishops occupy the same square colour: draw.
- Positions with pawns, rooks or queens: not insufficient material.
- Opposite-colour bishops and knight-versus-knight are not automatically classified as dead positions by this rule.

### 9. Root draw guard and root move retention

The root mate-in-one preflight is retained, but a root position already identified as a rule-50, threefold-repetition or insufficient-material draw is returned as a draw before the mate preflight can override it.

A second root-level defect was found during the final audit: path-sensitive TT protection correctly avoids storing a potentially path-dependent score, but the root search previously depended on that TT entry to recover the selected move. In a position near the 50-move threshold or with a prior repetition, the engine could therefore fall back to the first generated legal move even after searching the position.

M8 now retains the best root move independently of TT storage and also preserves the move when a valid root TT cutoff occurs. Regression tests cover both a halfmove-90 start position and a start position reached after one full knight repetition; both return the searched move `d2d4` rather than the generator's first move `a2a3`.

### 10. Transposition-table and memory layout

M8 expands the TT from M7's 131,072 entries to **262,144 entries**, arranged as 65,536 four-way buckets. Replacement prefers empty entries, then older/shallow entries.

Bounded history and continuation-history arrays use 16-bit storage. Their update values are explicitly clamped within the signed 16-bit range. This saves native/WASM memory while preserving the chosen bounded-history arithmetic.

### 11. UCI diagnostics and fair time comparisons

The UCI gauntlet now:

- Captures recent engine stdout/stderr in timeout diagnostics.
- Reports game, opening, ply, side to move, FEN and move history when a search times out.
- Supports opt-in per-ply trace output and an opening offset for isolating one opening.
- Sets `Move Overhead=0` on each engine that advertises the option, so optional protocol overhead does not give one engine a smaller effective move budget during a timed comparison.
- Reports the current engine as `Chelo V15 CPP M8`.

The native engine itself retains its normal 30 ms move-overhead default for interactive use. The zero-overhead setting is applied by the comparative gauntlet only.

The UCI search remains synchronous: a `stop` command cannot interrupt an active search until that search returns. M8 searches remain bounded by movetime, clock, depth or node limits; asynchronous UCI cancellation is a separate future improvement.

## Verification results

All tests below were run in the development container, which is **Linux x86-64**, Clang 17, Node 22.16. This is not an Android measurement.

| Test | Result |
|---|---|
| Native engine verification | PASS |
| Start-position perft depth 5 | 4,865,609 |
| Kiwipete perft depth 3 | 97,862 |
| Additional standard perft positions | All passed |
| Attack parity | PASS, deterministic playout corpus |
| SEE parity | PASS, deterministic playout corpus and 19 explicit capture positions |
| Castle/en-passant/promotion transitions | PASS |
| Incremental NNUE and Zobrist checks | PASS |
| Seven-position V37 + non-zero adapter evaluation parity | Exact |
| Repetition and rule-50 search tests | PASS |
| Root draw versus mate-preflight regression | PASS |
| Path-sensitive root best-move retention | PASS, 2 positions |
| Native time/node management | PASS |
| Mate-in-one retention | 50/50, zero illegal moves |
| WebAssembly build | PASS |
| Native/WASM fixed-node search parity | Bit-identical in the tested case |

The seven static-evaluation parity values were `10, -39, -29, 1200, 1657, 28, 202`. The V37 weights and non-zero Bond/Arena test adapters were used by the parity suite.

Native time-management test sample:

- `go movetime 160`: search 129 ms, completed depth 7 (137 ms wall time).
- Clock-based search: 134 ms, completed depth 8 (140 ms wall time).
- `go nodes 30000`: exactly 30,000 combined main-search and quiescence nodes (21 ms search time).

These are host-side test values; actual timings vary by device and thermal state.

## Same-host M7 versus M8 search diagnostics

M7 and M8 were compiled with the same Clang 17 `-O3 -std=c++20` host settings and evaluated in the same container. Seven fixed FEN positions were used. Each fixed-node search received exactly 200,000 combined main-search plus quiescence nodes.

### Fixed-node results

| Position | M7 depth | M8 depth | M7 move | M8 move |
|---|---:|---:|---|---|
| Start | 6 | 8 | g1f3 | d2d4 |
| Kiwipete | 5 | 6 | d5e6 | d5e6 |
| Endgame | 8 | 12 | b4f4 | b4f4 |
| Promotion tactics | 4 | 8 | c4c5 | c4c5 |
| Middlegame | 6 | 8 | c4e6 | c4e6 |
| Italian middlegame | 3 | 7 | d7d5 | h8g8 |
| In-check evasion | 13 | 19 | e1e2 | e1e2 |

M8 completed a deeper iteration in all seven sampled positions under the same node budget. It retained the same best move in five of seven positions. Different root moves in the other two positions are not, by themselves, evidence of a win or loss in playing strength.

The in-check test is particularly useful: the position allows White's king to capture an unprotected checking rook, leading to bare kings. M8 returns a draw score and detects insufficient material; M7 returned +413 cp. This is a concrete correction to M7's evaluation/search result for that test position.

### Fixed-time results

Each engine was asked to search the same seven FENs at the same UCI movetime. Figures below are the unweighted mean across those seven positions.

| UCI movetime | Mean completed depth M7 | Mean completed depth M8 | Mean NPS change M8 vs M7 | Positions where M8 was deeper |
|---:|---:|---:|---:|---:|
| 100 ms | 6.00 | 8.43 | +7.1% | 6/7 |
| 250 ms | 6.86 | 9.86 | +4.3% | 7/7 |
| 500 ms | 7.43 | 11.00 | +4.4% | 7/7 |

NPS changes vary by position. M8 is not uniformly faster in every FEN. The more consistent observation in this small corpus is the additional completed search depth. The larger four-way TT and corrected search horizon both affect these results, so this benchmark does not isolate any single change.

These diagnostics are useful evidence of search efficiency, not Elo evidence. Seven handcrafted positions do not represent a balanced chess population.

## UCI protocol smoke test

A 20-game colour-swapped smoke run against the Stage 3.9 JavaScript UCI wrapper completed all ten opening pairs at 10 ms per move and a 40-ply game cap:

- 1 win, 0 losses, 19 draws.
- 52.5% score; mechanically estimated +17.4 Elo difference.
- Approximate 95% sampling range: -135.1 to +169.8 Elo.

This was deliberately a low-time, short-ply protocol smoke test. The narrow game cap produced many draws. **The +17.4 figure is not a meaningful strength result and must not be reported as Chelo's Elo.** The useful result is that the M8 and Stage 3.9 UCI processes completed the tested opening set without an illegal-move or protocol failure.

## Remaining work before any strength claim

1. Run a 200–500+ game paired match between Stage 3.9 JS and M8 C++ on the same Android device, with full move history, the same V37 weights and genuinely equal time controls.
2. Run a separate M8 versus Stockfish limited-strength tournament. `UCI_Elo=2100` is an approximate limiter, not a guaranteed 2100 opponent rating.
3. Add a broader tactical corpus such as WAC/STS/Eigenmann and a set of endgame/tablebase positions.
4. Benchmark native ARM64/NEON and browser WebAssembly on the target phone. The current same-host measurements must not be labelled Android performance.
5. Correct the remaining quiescence horizon approximation: at the hard in-check qsearch cap, M8 currently uses a static evaluation of the checked node, matching the Stage 3.9 safety fallback. A future change should search at least one legal evasion before evaluation and be tested against a dedicated check-evasion tactical corpus.
6. Investigate native multithreading. The Stage 3.9 browser search has a multi-worker Lazy SMP path; the current native M8 UCI search is single-threaded. That architectural difference may matter if the historical JavaScript strength came from a four-worker run.
7. Implement asynchronous UCI `stop`/search cancellation if the target GUI or harness needs standard interruption semantics.
8. Once M8 has a trustworthy baseline, tune search extensions, pruning margins, history gravity, TT replacement and evaluation terms using paired matches rather than NPS alone.

## Acceptance criteria for calling M8 stronger

M8 should only be called stronger after:

- All correctness, model-parity and perft tests pass.
- No unresolved illegal moves, search timeouts or UCI protocol failures remain.
- A matched 200+ game paired comparison against Stage 3.9 gives a statistically supported positive result, followed by a larger confirming match if the margin is small.
- The result reproduces on the target Android device at the intended time control.
- A separate external-engine test gives a stable relative-strength estimate.

Until those conditions are met, the accurate description is: **M8 is a corrected and more efficient native search build with stronger verification evidence; its playing-strength gain remains unproven.**
