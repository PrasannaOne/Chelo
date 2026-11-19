# Chessling V4 — change log

## The AI model

- Replaced the V3 hand-authored positional evaluator with an individual 24-input, 12-hidden-unit neural value model.
- Fresh model output is neutral; traditional material values are not preloaded into the evaluator.
- Added back-propagation with bounded learning rate and model training statistics.
- Added online temporal-difference feedback after the opponent replies.
- Added compact, deduplicated experience replay with priority based on prediction error. Replay target averaging was checked and corrected to use consistent fixed-point units.
- Completed human games and completed visible self-play sessions train the neural value model.
- Preserved opening habit mirroring and FEN/action memory as complementary learning systems.
- Removed the old fixed piece-value table from evaluation and move-ordering heuristics. Legacy fields remain for Soul migration.

## Storage and portability

- Added compact V4 Soul encoding for model weights, replay examples and pending position vectors.
- Preserved V3 compact Soul migration and compatibility with older expanded brain objects.
- Kept the hard UTF-8 compact brain limit at 51,200 bytes.

## User interface and platform

- Replaced the old fixed piece-value bars with learned relative neural material signals.
- Added neural update and replay-memory counters.
- Updated the learning description to explain that the model trains from positions and experience.
- Bumped the service-worker cache to `chessling-shell-v6`.

## Validation

- Added `tests/learning.test.js` for neural convergence on a synthetic target, side-relative features, TD updates, replay deduplication, V3 migration and Soul model persistence.
- Updated smoke tests for V4 neural learning and compact Soul encoding.
- Playing-strength improvement is not yet established; see `AI_MODEL_VALIDATION.md`.
