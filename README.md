# Chessling V4 · Raise a chess monster

Chessling is an offline-first chess pet. Each pet begins with a neutral, untrained value model, remembers its own games, and learns from human play and visible self-play. The long-term game is pet-versus-pet: people raise creatures; the creatures compete.

## Run it

Serve this folder over HTTP so the Web Worker and Service Worker work reliably:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## What's new in V4

- **A real trainable neural model:** each pet has its own 24-input, 12-hidden-unit neural value model. It is used by the actual chess search, not just displayed in the UI.
- **Neutral start:** new model outputs begin at zero. It does not load conventional piece values or fixed positional preferences into the evaluator.
- **Learning during a game:** a pet records the position before its move and waits for the opponent's reply before applying temporal-difference feedback.
- **Experience replay:** completed games supply outcome labels. Compact replay examples are revisited to reinforce patterns and reduce the chance that old lessons vanish after one new game.
- **Original learning ideas preserved:** opening habit mirroring and FEN/action memory remain alongside the neural model. The network learns material preferences rather than receiving a hard-coded piece-value progression.
- **Same search budget for every pet:** Growth Elo never unlocks deeper search. The shared search uses the pet's current model to evaluate positions.
- **Visible Practice Mode:** the pet plays both colours on the actual board, move by move. It can be paused/resumed/stopped and automatically pauses when the page is hidden. It never runs a hidden match in the background.
- **No self-play rating farming:** practice sessions can train the model but do not change Growth Elo, Arena Elo, wins, losses or draws.
- **Premium convenience, not premium intelligence:** the UI reserves a locked “Skip to end · Pro” option. Fast-forward is not active until real Pro entitlements are implemented. Watching practice stays free.
- **Compact brain storage:** the full model, replay, pending training data, memories and pet state are measured against a hard cap of 51,200 UTF-8 bytes (50 KiB).
- **Soul portability:** new exports use compact V4 encoding. V3 compact Souls and older expanded brain objects can be imported.
- **Arena remains safely unranked:** challenges are not awarded Arena Elo until target-side AI move attestation is implemented.

## What's included

- `index.html`, `style.css`, `app.js` — mobile-friendly local experience and visible self-play.
- `chess.js` — dependency-free legal chess rules engine.
- `brain.js` — individual neural value model, online TD learning, experience replay, habit mirroring, position/action memory, compact Soul handling and the 50 KiB hard cap.
- `ai-worker.js` — off-main-thread search.
- `pieces.svg` — vector chess pieces.
- `sw.js`, `manifest.json`, `icon.svg` — PWA and offline shell.
- `arena/` — optional Cloudflare Arena foundation; challenges remain unranked until AI attestation is solved.
- `tests/` — chess, neural learning, storage, UI, PWA and Arena checks.
- `benchmarks/` — frozen-Soul A/B runner for comparing fresh and trained brains with equal search budgets.
- `CHESSLING_MASTER_SPEC.md` — product decisions and architecture.
- `AI_MODEL_ARCHITECTURE.md` — current model design.
- `AI_MODEL_VALIDATION.md` — test evidence and required chess-strength benchmarks.
- `CLAUDE_HANDOFF.md` — detailed brief for an independent model review/improvement pass.
- `CLAUDE_NEXT_STEPS.md` — remaining engineering and research backlog.
- `CHANGELOG_V4.md` — changes made in this foundation pass.
- `benchmarks/README.md` — how to compare fresh and trained frozen Souls.
- `reference/` — original Gemini/Pawnling ZIP and blueprint, plus the prior V3 snapshot, preserved for comparison.

## Core rules and data model

- Human-vs-pet games are played by the player as White and Chessling as Black.
- Practice Mode is the same pet on both sides. It is rehearsal only, never a ranked result.
- The pet starts at a local Growth Rating marker of 100. This is not a calibrated playing-strength or Arena rating.
- Arena Elo is separate and is not currently active.
- The compact pet brain is at most 50 KiB (51,200 bytes). Current-game history is stored separately from the brain.
- Soul export/import preserves identity, model, replay, memories, traits, stats and optional active game.
- Undo in a human match restores the brain snapshot from before that turn.

## Honest limitations

V4 now includes a real small neural network with back-propagation, online temporal-difference updates and experience replay. That is materially different from the V3 adaptive heuristic. It is still a compact experimental value model, not AlphaZero, Maia or a proven high-strength engine. The feature encoder is handcrafted, the search uses alpha-beta, and measured playing-strength improvement is not established. See `AI_MODEL_VALIDATION.md` before making a public strength claim.

The Arena Worker is not connected to the local interface. It does not yet provide token recovery, moderation, complete abuse controls, payments or Pro entitlement checks. Its current challenge route checks that a submitted match is legal but cannot prove the target pet itself generated its moves. It therefore stores challenges as unranked and does not change Arena Elo. The intended anti-farming rule is at most three ranked matches per challenger trainer against a given pet per UTC day; self-play never earns rating at all.

## Tests

With Node.js installed, run:

```bash
node tests/smoke.test.js
node tests/learning.test.js
node tests/worker.test.js
node arena/worker.test.mjs
```

Or run all checks together with `./run-tests.sh`.

## Original project input

The complete Gemini-generated Pawnling starter and its blueprint remain under `reference/`. The original ZIP was not overwritten.
