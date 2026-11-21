> Historical learner-validation plan. The app no longer includes a self-play/Practice Mode; any future test self-play must remain an offline test harness, not a player-facing feature.

# Chelo V6 learning and retention validation plan

## Current benchmark implementation

The current harness is `benchmarks/v6-tactical-retention.js`, using the versioned dataset `benchmarks/data/mate-in-one-50.json`.

It verifies 50 legal positions where the designated move gives immediate checkmate, measures policy top-1 recall and mean reciprocal rank, trains on the fixed curriculum, applies random-legal self-play interference, and re-tests the same positions. It reports the position-level scores before training, after curriculum learning and after interference. It also reports Soul bytes, retained memories/replay/pending items and learning update counts.

The saved V13 run is `benchmarks/results/v13-tactical-retention-50x100.json`:

- 20 curriculum epochs.
- 100 random-legal self-play episodes, alternating pet colour.
- Each episode stops at 20 plies unless terminal earlier.
- 100/100 episodes reached the 20-ply horizon; 0 completed games.
- Policy top-1 recall: 4% before learning, 52% after learning, 52% after interference.
- MRR: 0.1250 before learning, 0.6702 after learning, 0.6638 after interference.
- Relative episode-level retention: 100% top-1 and 99.05% MRR.

This is a narrow mate-in-one policy-ranking result from one seed. It does not meet the requested 85% retention after 50 **completed** interference games and does not measure general playing strength or multi-move tactics.

## Full retention protocol still required

1. Freeze the current candidate and save a Soul checkpoint.
2. Use multiple independently verified tactical, positional and endgame curricula. Keep test positions disjoint from interference games and report unseen-position generalisation separately.
3. Record baseline and post-curriculum policy recall, acceptable-move rate, solve rate, WDL/value score and search choices per position.
4. Run 10, 25 and 50 **completed** interference games, not fixed-ply episodes. Alternate colours and random seeds.
5. Include a no-interference control and a fresh-model control.
6. Retest exactly the original curriculum with identical inference/search limits. Repeat after Soul export/import and storage pruning.
7. Report individual positions, means, uncertainty intervals, storage usage, replay/memory counts and examples that were learned then forgotten.
8. Repeat for Free and Pro storage caps while ensuring both have identical network, learning algorithm and search budget.

Qwen proposed at least 85% retention after 50 interference games. Keep this as a provisional target to calibrate across difficulty and seeds; it is not yet a passed gate.

## Storage/quantisation research

Current Soul v13 uses Int4 for the large input/residual/policy arrays and Int8 for WDL/bias arrays. Canonical positions are packed with piece, side, castling and en-passant state; replay/pending entries reference shared position rows when possible. Round-trip tests include en-passant target decoding.

The existing 100-episode pilot reached 50,297 / 51,200 bytes, leaving 903 bytes, six memory positions and 160 replay entries. Free memory pressure is not solved. Next experiments should compare diversity-aware replay, rare-tactic protection, reversible consolidation and more compact experience summaries. Every compression must have exact state/metadata round-trip tests and a downstream policy/value drift measurement.
