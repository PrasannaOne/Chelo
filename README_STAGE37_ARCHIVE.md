# Chessling V6 — Stage 3.7 Dual-Perspective NNUE

**Product:** an offline-first, Tamagotchi-inspired chess companion. Players raise an individual Chessling, play against it, watch visible self-practice, discover its learned habits and eventually compete with other players' pets.

**Product principle:** the chess rules are fixed; strategic preferences must be earned through experience. The engine is shared and fair, while each pet's brain, memories and personality history are personal.

**Current engine:** Stage 3.7 uses the uploaded C36N dual-perspective NNUE model `(768 → 32) × 2 → 64 → 1`, with V15 Bond/Arena LoRA compatibility and the four-worker SharedArrayBuffer Lazy SMP search. Its 49,368-byte binary passed header/SHA checks and two 60-game paired Node gauntlets (against Stage 3.4C and the Stage 3.6 bootstrap model). The lower 95% paired-opening Elo bounds were positive in both tests. Browser/Android production validation and independent verification of the uploader’s Kaggle training provenance remain open. See `STAGE37-RELEASE-REPORT.md`.

## Start here

1. Read `V6_MASTER_CHECKLIST.md` for the complete product, engineering and release checklist.
2. Read `CHESSLING_MASTER_SPEC.md` for the agreed product vision.
3. Read `AI_MODEL_ARCHITECTURE.md` for the actual model source design.
4. Read `AI_MODEL_VALIDATION.md` and the `benchmarks/results/` JSON for exact evidence and limitations.
5. Read `V6_PROGRESS.md`, `V6_CHANGELOG.md` and `V6_ENGINE_AUDIT.md` for the development history.

## Run locally

Serve this folder over HTTP so Service Worker and module behaviour work reliably:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Original V13 pet-learning model (separate from the chess evaluator)

- Sparse input: 80 values expanded into 784 relative piece/state features.
- Neural trunk: 784 → 48 tanh units.
- Residual refinement: 48 → 48, zero-initialised for migration continuity.
- Value: three-class win/draw/loss softmax trained with delayed TD and cross-entropy.
- Policy: legal-candidate from/to/piece/promotion embeddings plus rank-4 from/to interaction.
- Trainable parameters: **47,694**.
- Soul: v13, per-channel Int4 for large trunk/residual/policy arrays, Int8 for WDL/bias arrays, packed-FEN keys and compact replay/pending references.

Free and Pro use exactly the same model, learning algorithm and search budget. Free allows 51,200 bytes per pet; Pro allows 512,000 bytes for additional individual history. Pro is not a stronger AI.

## What the current tests establish

- WDL classes and a legal-move policy can learn controlled synthetic targets.
- V13 residual weights train, and V11/V12 pets preserve their previous predictions at the moment the zero residual layer is introduced.
- Soul v13 round-trips and imports supported V4 through V12 formats.
- Packed position keys preserve en-passant fields after a dedicated regression fix.
- The 50-position mate-in-one curriculum raised policy top-1 recall from 4% to 52%; after 100 short random self-play interference episodes it remained 52% (100% relative top-1 retention and 99.05% MRR retention).

These are narrow model/serializer/retention signals. They do **not** prove general chess strength. The 100 interference episodes all stopped at 20 plies; zero completed games were recorded. The same test used 50 fixed mate-in-one positions and one seed. See `AI_MODEL_VALIDATION.md` for details.

## Storage and performance warning

The 100-episode tactical-retention fixture reached 50,297 / 51,200 bytes (903 bytes remaining) and retained six position-memory entries plus 160 replay entries. Free long-term memory pressure remains a blocking research issue. The 48-unit shape fits the measured fixture; wider 56-unit candidates leave very little experience capacity, while 64 units exceed the Free cap after the same synthetic updates.

Local Node inference measurements are not Android measurements. Mid-range device CPU, battery, memory and thermal tests remain open.

## Tests

With Node.js and Python 3 installed:

```bash
./run-tests.sh
```

The current test programs include:

- `node tests/smoke.test.js`
- `node tests/learning.test.js`
- `node tests/v6-engine.test.js`
- `node tests/worker.test.js`
- `node arena/worker.test.mjs`
- `python3 tests/arena_schema.test.py`

`run-tests.sh` includes a one-game/four-ply CI smoke mode. This checks benchmark wiring only. The combined shell runner has intermittently stalled after the AI Worker invocation in this environment, although each test program has passed when executed separately. That harness issue must be fixed before describing the aggregate script as consistently green.

## Benchmark commands

Shape feasibility (local Node timing only):

```bash
node benchmarks/v6-model-shapes.js --iterations=1000 --passes=3 --warmup=500
```

Quantisation fidelity (synthetic policy/value targets):

```bash
node benchmarks/v6-quantization-ablation.js benchmarks/results/local-quantization.json
```

Tactical retention (50 verified mate-in-one positions; 100 episodes truncated at 20 plies):

```bash
node benchmarks/v6-tactical-retention.js --epochs=20 --games=100 --max-plies=20 --seed=20261119 --report=benchmarks/results/local-retention.json
```

Chess strength evaluation, only after choosing a reasonable runtime budget:

```bash
node benchmarks/v6-learning-benchmark.js --train=10 --games=12 --time=80 --nodes=4000 --plies=100 --seed=20261119 --report=benchmarks/results/local-strength.json
```

For a quick CI wiring check only:

```bash
node benchmarks/v6-learning-benchmark.js --smoke=1 --train=0 --games=1 --time=80 --nodes=128 --plies=4 --seed=20261119 --policy=off
```

Never count the smoke result as chess-strength evidence.

## Project structure

- `brain.js` — per-pet neural model, WDL/policy learning, replay, memory, search and Soul serialization.
- `chess.js` — dependency-free legal chess rules.
- `app.js`, `index.html`, `style.css` — current research shell and visible-practice UI. It is not yet the agreed board-first V6 redesign.
- `ai-worker.js` — off-main-thread search.
- `arena/` — optional Cloudflare Worker/D1 account/Arena foundation and migrations; production accounts and ranked attestation are incomplete.
- `tests/` — rule, learning, storage, UI, worker and schema tests.
- `benchmarks/` — model-shape, quantisation, retention and frozen chess evaluation tools/results.
- `reference/` — original Pawnling blueprint, historical versions and handoff material.
- `baseline/` (in the master package) — preserved V5 comparison source.

## Product scope not yet implemented

The master checklist includes the board-first unscrollable interface, left swipe drawer with personality at its top, header heart/share/overflow, owner-vs-pet play, visible practice, account-only Arena/leaderboard/friend challenges, live spectators, five-pet Pro custom battles, monthly boards/pieces and legacy cosmetics, Soul portability and anti-tamper validation.

The agreed production route is GitHub source/version control → Cloudflare Pages hosting → Workers + D1 for accounts/social/Arena, with IndexedDB and Service Worker for offline play. The master ZIP also includes a separate `00-GitHub-Pages-Deploy/` static preview/upload bundle for convenience. It is not the final production-hosting choice and has not been deployed.

## Safety and release boundaries

- No paid AI API and no pay-to-win engine.
- No hidden background training, fake intelligence growth or false strength claims.
- Self-practice never earns Arena rank.
- Browser-submitted results are not trusted for ranked matches; the server must validate legal moves and independently attest eligible pet actions.
- Nothing in this folder is deployed. Production deployment requires completed release gates and explicit approval.
