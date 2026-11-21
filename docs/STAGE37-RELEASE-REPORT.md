# Chelo V14 Stage 3.7 — Uploaded Dual-Perspective NNUE

**Release status:** Stage 3.7 benchmark-validated release candidate; mobile/browser production validation remains outstanding.  
**Base code:** Stage 3.6 dual-perspective NNUE / four-worker SharedArrayBuffer Lazy SMP.  
**Model change:** replace only `models/dual-nnue-v37.bin` with the user-supplied trained model; update worker SHA-256 pin, manifest, and service-worker cache version. No evaluator, search, `.soul`, or LoRA code was rewritten for this weight swap.

## 1. C36N binary integrity

Uploaded `dual-nnue-v37.bin` was integrated at `models/dual-nnue-v37.bin`.

| Field | Verified value |
|---|---:|
| File size | **49,368 bytes** |
| Magic | `C36N` |
| Format version | 1 |
| Feature count | 768 |
| Hidden units per perspective | 32 |
| Flags | 1 |
| Output divisor | 1,048,576 |
| Reserved header word | 0 |
| SHA-256 | `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e` |

The payload layout is consistent with the parser: White and Black `Int8` transformer matrices (768 × 32 each), two `Int16` bias vectors (32 each), an `Int8` 64-unit output vector, and an `Int32` output bias. The production worker's SHA pin and `models/dual-nnue-v37.sha256` match the uploaded file. `src/nnue/dual-nnue.js` successfully parses and loads it. The service-worker cache was bumped to `chelo-shell-v17-stage38` so the model and worker refresh together.

The previous Stage 3.6 bootstrap model is preserved at `benchmarks/references/stage36/models/dual-nnue-v36-bootstrap.bin` with SHA-256 `7dd7c781baf171f7a16506074012d8ac669b7e4003c8b0d255a7561b3ba96b56`.

## 2. V15 Bond/Arena Soul compatibility

Cross-version fixture tests created Stage 3.6 V15 adapters, exported standalone `Bond_LoRA` and `Arena_LoRA` Soul payloads, then imported them into the Stage 3.7 model runtime.

- Bond rank-1 standalone Soul: 221 bytes.
- Arena rank-2 standalone Soul: 310 bytes.
- Full Soul schema: V15.
- Bond/Arena adapter tensors survive standalone import/export bit-identically.
- Full V15 Soul import preserves both adapter tensor sets bit-identically.
- Fixed-point White and Black hidden-bias deltas are bit-identical across Stage 3.6 and Stage 3.7.

**Scope:** these are deterministic test fixtures, not user-supplied production pet Souls. Different NNUE base weights naturally produce different final evaluations; the parity guarantee here is the V15 adapter payload and adapter-delta application, not identical evaluations between different models.

## 3. Regression and integration tests

Passed on the swapped model:

- `node tests/stage37-binary-integrity.test.js`
- `node tests/stage37-chelo-adapter-parity.test.js (renamed in M4)`
- `node tests/dual-nnue.test.js` (90-ply incremental/unmake parity; en-passant, castling, promotion; 30,000-node deterministic repeat)
- `node tests/worker.test.js` (actual worker loader path, SHA-pinned binary, SAB helper path)
- `node tests/fast-search.test.js`
- `node tests/v6-engine.test.js`
- `node tests/engine-hardening.test.js`
- `node tests/learning.test.js` (passed in the earlier isolated test invocation)
- `python3 -m py_compile training/train_nnue.py`

This is the historical Stage 3.7 validation record. Stage 3.8 test commands and current results are documented in `STAGE38-RELEASE-REPORT.md` and `../STAGE38-VERIFICATION-RESULTS.json`.

## 4. Stage 3.7 vs Stage 3.4C — 60-game paired gauntlet

| Protocol | Value |
|---|---:|
| Games | 60 |
| Opening pairs | 30 distinct lines, color-swapped |
| Candidate | Stage 3.7, four-worker persistent SAB Lazy SMP |
| Opponent | Supplied Stage 3.4C, single-thread frozen V14 evaluator |
| Move budget | 20 ms per move for both sides |
| Total-ply cap | 100 |
| Search caps | 10,000,000 nodes; depth 10 |
| Opening seed | `0x37A15075` |
| Book / policy | Disabled for both |

| Result | Count |
|---|---:|
| Stage 3.7 wins | **51** |
| Stage 3.7 losses | **4** |
| Draws | **5** |
| Score | **89.17%** |
| Elo point estimate | **+366.18** |
| Paired-opening 95% Elo CI | **+267.82 to +550.37** |
| 100-ply cap draws | 4 |

The raw JSON and CSV were audited: 30 unique opening FENs, 30 White-candidate and 30 Black-candidate games, 60 recorded games, no missing move histories, and all 30 paired scores recompute from the underlying two game outcomes.

## 5. Stage 3.7 vs Stage 3.6 — weight-only 60-game paired gauntlet

This is the cleaner model comparison. Both sides used four-worker persistent SharedArrayBuffer Lazy SMP, the same 20 ms/move budget, 100-ply cap, depth/node limits, book/policy-off settings, and the same frozen V14 checkpoint. The only changed artifact was the C36N binary. Source SHA-256 checks for `src/engine/fast-search.js`, `src/soul/brain.js`, `src/nnue/dual-nnue.js`, `src/engine/chess.js`, `src/engine/endgame-kpk.js`, and `models/base-v14-float32.json` are identical between the compared trees.

| Protocol | Value |
|---|---:|
| Games | 60 |
| Opening pairs | 30 distinct lines, color-swapped |
| Stage 3.7 model SHA | `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e` |
| Stage 3.6 bootstrap SHA | `7dd7c781baf171f7a16506074012d8ac669b7e4003c8b0d255a7561b3ba96b56` |
| Move budget | 20 ms per move each |
| Total-ply cap | 100 |
| Search caps | 10,000,000 nodes; depth 10 |
| Opening seed | `0x37A13636` |
| Book / policy | Disabled for both |

| Result | Count |
|---|---:|
| Stage 3.7 wins | **45** |
| Stage 3.7 losses | **3** |
| Draws | **12** |
| Score | **85.00%** |
| Elo point estimate | **+301.33** |
| Paired-opening 95% Elo CI | **+217.96 to +428.80** |
| 100-ply cap draws | 9 |

The raw JSON/CSV audit confirms 30 unique opening FENs, 30 games in each candidate color, 60 games, no missing move histories, and consistent paired scores. The first run’s JSON serializer retained Stage 3.7 controller metrics but omitted the Stage 3.6 opponent’s aggregate search counters; this telemetry omission does not affect the fully recorded move histories, outcomes, paired scores or Elo/CI calculations. The reusable harness has been corrected to retain both sides in future runs.

## 6. Interpretation and limits

Both 60-game paired comparisons have lower 95% confidence bounds above zero under this Node.js benchmark protocol. The Stage 3.7-vs-Stage 3.6 weight-only comparison is especially important because the engine source and worker architecture were held constant. This supports promoting the submitted binary to the Stage 3.7 model candidate.

These are **relative tournament estimates in this harness**, not an absolute 3,050+ Elo rating. The first comparison also includes the Stage 3.7 four-worker Apex configuration against the Stage 3.4C single-thread baseline; it must not be interpreted as a pure model-only comparison. The Node `worker_threads` harness is not a substitute for Chromium/Android browser tests or cross-device timing/fairness tests.

The uploader's Kaggle T4 / 5M Stockfish depth-18+ position provenance is not independently verifiable from the binary alone. See `STAGE37-TRAINING-PROVENANCE.md`.

## 7. Release decision

**Promote the uploaded C36N weights as the Stage 3.7 benchmark-validated model.** Keep the Stage 3.6 bootstrap binary archived for reproducibility. Before production rollout, run real-browser worker loading, service-worker update, and Android low-end/flagship device validation. No claim of an absolute 3,050+ Elo rating is made.
