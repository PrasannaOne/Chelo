# Claude handoff — Chessling V4

You are receiving the complete Chessling project. Your job is to review and improve the actual AI learning model, not merely restyle the interface or rename the existing heuristics.

## First: understand the project before editing

Read these files first, in this order:

1. `CHESSLING_MASTER_SPEC.md` — product decisions and non-negotiable behaviour.
2. `AI_MODEL_ARCHITECTURE.md` — the current neural-learning design.
3. `AI_MODEL_VALIDATION.md` — what is tested and, importantly, what is not proven.
4. `reference/PAWNLING_MASTER_BLUEPRINT.md` — the original Gemini product/learning blueprint.
5. `README.md`, `brain.js`, `chess.js`, `app.js`, `ai-worker.js` and all files under `tests/`.
6. `reference/Gemini-Pawnling-Original.zip` — the untouched original starter archive.

Do not assume that a README claim is true merely because it is written down. Check the implementation and tests. Preserve the original ZIP and blueprint unchanged.

## Product intent

Chessling is an offline-first Tamagotchi-style chess pet. The human raises a pet; the pets eventually fight in the global arena. It is not a conventional human-v-human chess website.

The pet knows chess rules from birth because the shared chess rules engine enforces them. Its strategic understanding should be earned from experience. The phrase guiding the product is: **“The rules are engraved. The intelligence is earned.”** Do not simulate growth by unlocking deeper search, changing time budgets based on rating, or hard-coding a staged skill slider.

The user specifically wants a machine-learning-like pet that learns from:
- human games, including casual players;
- visible self-play practice;
- stronger opponents and other pets when available;
- its own successful and unsuccessful decisions;
- consequences observed after the opponent responds;
- repeated experience and useful position memories.

Learning must be individual. Two pets raised differently should be able to develop different weights, memories, habits and play styles.

## What V4 currently implements

`brain.js` now contains a compact 24 -> 12 -> 1 tanh neural value model with 313 trainable parameters. It starts with a neutral output layer. The model is used by the actual chess search evaluator. It receives online temporal-difference feedback after an opponent reply and trains from completed-game outcome labels through a bounded experience replay set. The existing opening-habit memory and FEN/action memory remain.

The value model is a real trainable neural network, but this is only a small prototype. It does not prove playing-strength improvement. The 24 inputs are handcrafted board descriptors; the model learns their importance. The search is still an ordinary alpha-beta engine around the learned value function. There is no policy network, AlphaZero-style training, MCTS, large training corpus or distributed self-play.

## Highest-priority work for you

### 1. Audit the learning correctness

- Check the side-to-move perspective at every point in `observePetMove()` and `resolveLastPetMove()` for human games and self-play.
- Verify that a pending action is not trained before the opponent has replied.
- Check checkmate, stalemate, draw claims, resignation/abandonment and interrupted practice handling.
- Confirm that results are correctly mapped to the perspective of each stored position.
- Review whether the TD target should be TD(0), TD(lambda), n-step return or another approach. Explain trade-offs.
- Check whether the current supervised terminal labels across all recorded positions cause over-crediting/over-punishment of moves that were not causal.
- Verify that the learner does not accidentally train against a state with the wrong turn or wrong point of view.

### 2. Improve actual machine learning

Research and compare plausible offline/browser-friendly approaches, such as:
- temporal-difference learning with eligibility traces;
- n-step TD and value replay;
- a small learned policy/value model;
- board encodings with piece-square features or compact spatial layers;
- self-play league snapshots/opponent pools to reduce identical self-play cycles;
- supervised imitation signals from the trainer's moves, carefully separated from result reinforcement;
- uncertainty-aware replay and protection against catastrophic forgetting.

Do not add all of these just because they sound advanced. Choose a design that is computationally viable on ordinary Android phones and can be explained, tested and kept under the storage cap. Avoid fake complexity.

The user is not asking for a static chess engine with an AI label. They want learning that changes model parameters from real experience. Any model change must feed into the move selection/evaluation path, not just update a dashboard number.

### 3. Prove improvement

Build repeatable benchmarks that compare:
- a frozen fresh V4 pet;
- a pet trained with human games;
- a pet trained with visible self-play;
- a pet trained against stronger/diverse opponents;
- the previous version/baseline where useful.

Use identical engine code and search budgets for fair comparisons. Alternate colours, rotate openings and run enough games to reduce noise. Keep a held-out test set untouched. Do not declare victory based on a single game, training loss, model update count or displayed Growth Rating.

If the model does not improve in measured tests, say so and change it. A failed training experiment is useful information.

### 4. Respect the compact brain

- Strict maximum: **51,200 UTF-8 bytes (50 KiB) per pet brain**.
- The limit is not a number-of-games limit.
- Model parameters, replay, pending experiences, identity, traits, habits and memories all count.
- Use measured storage size, not estimated position counts.
- Preserve Soul export/import and migration from V3 compact Souls and older expanded Souls.
- Never discard model weights to make the size meter look healthy. Prefer removing low-value old episodic records and duplicate replay.
- Verify exact round-trip predictions after export/import.

### 5. Preserve product rules

- New pet begins with a 100 local Growth Rating marker, not a claim of calibrated 100 Elo strength.
- Self-play is optional and fully visible move by move. It pauses when the page is hidden. No hidden/background grinding.
- Self-play changes no rating and no W/L/D record, even after the first match.
- Watching practice remains free. A future Pro feature may fast-forward/skip the visible wait; it must not give a stronger learning algorithm or better intelligence.
- Every pet gets the same configured search budget. Growth Rating does not unlock extra depth or compute.
- Keep the original three ideas: opening habit mirroring, position/trap memory and evolving piece values. The neural model may implement evolving material valuation, but do not silently erase the earlier ideas.
- Preserve each pet's individuality and the 50 KiB limit.
- Arena matches are pet-versus-pet. The intended anti-farming limit is at most three Elo-earning matches per challenger trainer against a target pet per UTC day. Self-play never earns Arena Elo.
- Do not turn browser-submitted unverified results into ranked Arena Elo. The current Worker deliberately leaves challenges unranked until target-side move attestation is solved.
- Free core game stays complete and ad-free. Pro monetises convenience/collection/customisation, not artificially crippled intelligence.
- Current global Pro prices discussed: $4/month, $25/year, $49.99 for five years. India pricing remains separately undecided.

## Output requested from Claude

Please return a full updated project ZIP, not isolated snippets. Include:

1. Updated working source code.
2. `AI_MODEL_ARCHITECTURE.md` describing the chosen model in plain English and technical detail.
3. `AI_MODEL_VALIDATION.md` with actual test results, sample sizes and clear limitations.
4. `CHANGELOG.md` describing material changes.
5. Updated tests and a one-command test runner if practical.
6. `CLAUDE_NEXT_STEPS.md` documenting remaining work and unresolved design decisions.

Before claiming that AI strength improved, run the held-out benchmarks and report the exact evidence. Clearly separate implemented behaviour, synthetic learning tests, real-game learning tests and measured playing-strength improvement.

## How to work safely

- Preserve the project structure and original references.
- Do not replace the chess rules engine without running perft and special-move tests.
- Do not delete offline/PWA functionality, Soul portability, practice viewing, or original design decisions.
- Do not add paid model APIs or external runtime dependencies.
- Optimize mobile performance and monitor search time/node count.
- Bump the service-worker cache version whenever cached files change.
- Inspect the complete ZIP before returning it. Run all tests from the project root and include results.
- If a desired improvement cannot be responsibly implemented in this pass, document it rather than pretending it is complete.
