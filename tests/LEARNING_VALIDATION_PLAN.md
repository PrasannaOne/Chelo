# Chessling V4 — Learning validation plan

This file is retained for continuity with the V3 test plan. The current model design and validation status are documented in:

- `AI_MODEL_ARCHITECTURE.md`
- `AI_MODEL_VALIDATION.md`
- `CLAUDE_HANDOFF.md`

## Current technical tests

Run:

```bash
node tests/smoke.test.js
node tests/learning.test.js
node tests/worker.test.js
node arena/worker.test.mjs
```

The neural-learning test checks neutral initialization, synthetic value learning, side-relative features, online temporal-difference updates after an opponent reply, replay deduplication/training, V3 Soul migration, and exact neural prediction preservation after Soul export/import (within compact rounding tolerance).

The smoke suite checks chess rules, perft, special moves, draw rules, habit mirroring, position-memory influence, neural updates, completed self-play learning, no-rating self-play, the 50 KiB cap, mate-in-one, UI and offline shell assets.

## Playing-strength benchmark still required

1. Freeze a fresh model and a trained model.
2. Use fixed held-out positions and games that are never used for training.
3. Give both models exactly the same source code, search time, node limits and hardware.
4. Alternate colours and opening seeds.
5. Compare against a frozen V4 model, random-legal opponent, material-greedy baseline, older V3 build, and an independently verified chess engine where available.
6. Run enough games to report uncertainty. Record sample size, seed, opponent, time/node budget, wins/draws/losses, tactical accuracy, blunders, material loss, missed mates and wall-clock cost.
7. Repeat after Soul export/import and brain pruning.
8. Do not tune against the held-out test set.

## Current conclusion

The code now contains an actual trainable neural value model and its synthetic/structural learning tests pass. That demonstrates learning code operation, not improved chess skill. **A repeatable increase in playing strength remains unproven.**
