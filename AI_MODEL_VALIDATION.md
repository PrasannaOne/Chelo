# Chessling V4 — AI Validation Report

## Current implementation status

| Area | Status | Evidence |
|---|---|---|
| Per-pet neural value model | Implemented | 24 inputs, 12 hidden units, 1 output; 313 trainable parameters |
| Neutral new-pet output | Tested | Fresh model returns 0 for a zero feature vector |
| Back-propagation | Tested | Synthetic feature/outcome test learns a positive value signal |
| Online temporal-difference update | Tested | A stored move is updated after the simulated reply |
| Completed-game outcome learning | Implemented | Training samples are labelled from the result and added to replay |
| Experience replay | Implemented | Duplicate consolidation, priority and bounded replay are tested |
| Human and self-play integration | Implemented in app loop | Human response and practice response both resolve pending decisions |
| Soul model persistence | Tested | Export/import preserves neural predictions within compact rounding tolerance |
| V3 compact Soul migration | Tested | V3 compact fixture migrates to a new V4 model |
| 50 KiB cap | Tested | Exact compact UTF-8 payload is checked against 51,200 bytes |
| Frozen-Soul A/B benchmark runner | Implemented and smoke-tested | `benchmarks/duel.js` runs two frozen Souls with identical search limits and alternating colours; the 2-game smoke run reached the ply cap in both games, so it validates execution only |
| Higher chess playing strength | **Not established** | Requires held-out games/positions and controlled opponent benchmarks |
| Full browser/device playtest | Pending | Automated Node tests and static UI checks pass; a headless browser run did not complete in this environment |

## Tests run

Run from the project root:

```bash
node tests/smoke.test.js
node tests/learning.test.js
node tests/worker.test.js
node arena/worker.test.mjs
```

The learning test uses a synthetic target to verify that the neural network can fit a simple feature/outcome relationship. The current run reached approximately **0.78 predicted value after 800 updates**, starting from exactly **0.000**. It also verifies side-relative features, online TD resolution, replay, V3/V2 migration, and model portability. This demonstrates that the learning code changes model parameters in the expected direction. It does **not** prove that Chessling plays stronger chess after real games.

The smoke suite also checks move legality, standard perft counts, special moves, mate-in-one, opening mirroring, position-memory influence, practice rating separation, Soul handling, PWA files and storage limits. The replay regression tests verify that repeated experiences are averaged without mixing fixed-point and floating-point scales. The frozen-Soul benchmark runner has been executed as a short fresh-versus-fresh smoke test; both games were intentionally capped at 20 plies, so this is not playing-strength evidence.

## Required playing-strength benchmark before public claims

1. Freeze a baseline Soul before training and a second Soul after a defined training curriculum.
2. Create a versioned test suite of legal positions and complete games. Keep a held-out set that is never used for learning or tuning.
3. Include both tactical and strategic test positions: mate threats, hanging pieces, safe captures, defensive moves, pawn endings, king safety and opening-to-middlegame transitions.
4. Test both colours and rotate move order/opening seeds.
5. Give baseline and trained versions exactly the same search time, node budget, engine code and hardware.
6. Use several opponent types: frozen V4 baseline, random-legal opponent, material-greedy opponent, older V3, and at least one independently verified chess engine if a suitable local executable is available.
7. Run enough games for confidence intervals. Report games, score, colour split, opponent, time/node limits, model version and seed. Avoid relying on a small anecdotal sample.
8. Record rating-independent metrics: tactical puzzle accuracy, missed forced mates, one-move blunders, material loss, legal move rate, evaluation stability, game score and wall-clock search cost.
9. Compare fresh, trained, Soul-exported/imported and post-pruning brains to ensure that portability and the byte cap do not silently destroy learning.
10. Keep an untouched test set. Do not tune the model against the held-out test results.

## Important interpretation

- The 100 starting number is a local Growth Rating marker, not a calibrated FIDE/Elo strength estimate.
- Self-play is training only. It never changes any rating or competitive record.
- The future Arena Elo must be based on independently verified pet-versus-pet games. The current Worker deliberately leaves submitted challenges unranked until it can attest that the target pet generated the moves.
- The neural model is currently a value estimator used by search. It is not a move-policy network and does not learn the chess rules.
