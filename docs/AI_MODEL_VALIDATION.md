> Historical validation procedure. Random self-play mentioned here is a developer-side test harness only; player-facing Practice/self-play has been removed from Chelo.

# Chelo V6 — AI Model Validation (V13)

**Current candidate:** Soul v13, 784 expanded input features, 48 hidden units, zero-initialised 48-unit residual block, WDL head and rank-4 bilinear legal-move policy. **47,694 trainable parameters.**

**Conclusion:** the architecture, serializer and learning paths pass focused regression tests. Tactical policy learning and retention have promising narrow results. General chess-strength improvement is still unproven.

## 1. Regression coverage

The following test programs have been run individually in the current work copy:

- `node tests/smoke.test.js`: chess-core perft, special moves, checkmate, draw rules, UI/PWA source smoke, model dimensions, legal search and mate-in-one.
- `node tests/learning.test.js`: WDL win/draw/loss learning, policy learning, delayed TD feedback, replay, pre-update policy advantage, Free/Pro model parity, Soul v13 Int4 round trip, V4–V12 migrations, residual-layer preservation, compact FEN/replay references, en-passant FEN decoding and no owner/opening-frequency forced copying.
- `node tests/v6-engine.test.js`: terminal draws, quiescence draw handling, legal search and immutable root.
- `node tests/worker.test.js`: AI Worker move legality and response compatibility.
- `node arena/worker.test.mjs`: Arena Points, daily pairing cap, legal replay and rank-attestation safety helpers.
- `python3 tests/arena_schema.test.py`: fresh schema, V4 migration, shared case-insensitive handle registry and collision refusal.

`run-tests.sh` also includes a deliberately tiny four-ply benchmark smoke mode. In this environment, the combined shell runner has intermittently stalled after the worker-test invocation even though the worker and Arena test programs passed when run individually. Therefore the individual passing results above are the reliable report; do not describe the aggregate runner as consistently green until that harness behaviour is resolved.

## 2. Active architecture feasibility

`benchmarks/v6-model-shapes.js --iterations=1000 --passes=3 --warmup=500` tested 500 synthetic value updates, Soul export/import and local Node inference. The timing is a median of three 1,000-prediction passes in this environment, not Android performance.

| Hidden width | Parameters | Soul bytes after 500 updates | Fits 51,200-byte empty-Free cap? | Median 1,000 predictions |
|---:|---:|---:|:---:|---:|
| 24 | 23,598 | 21,450 | Yes | 43.69 ms |
| 32 | 31,502 | 27,931 | Yes | 53.07 ms |
| 40 | 39,534 | 34,449 | Yes | 65.66 ms |
| **48** | **47,694** | **41,057** | **Yes** | **75.31 ms** |
| 56 | 55,982 | 47,799 | Barely | 91.63 ms |
| 64 | 64,398 | 54,555 | No | 100.96 ms |

The 48-wide candidate is a capacity compromise, not a measured chess-strength winner. Width 56 leaves only 3,401 bytes after the synthetic 500-update fixture, and width 64 exceeds the Free budget. A real Android device benchmark remains mandatory.

## 3. Int4 quantisation fidelity

`benchmarks/v6-quantization-ablation.js` generated 252 positions from random-legal games, trained policy/value heads on synthetic preference/outcome targets, exported/imported Soul v13 and compared predictions.

- Policy top-move agreement after Soul round-trip: **94.84%**.
- Mean policy rank correlation: **0.997995**.
- Mean absolute policy-probability delta: **0.00001865**.
- Mean absolute WDL-class probability delta: **0.00018159**.
- Trunk JSON encoding: 50,194 bytes Int8 versus 25,719 bytes Int4, saving 48.76% for that array's packed JSON representation.
- Policy arrays: 8,968 bytes Int8 versus 6,971 bytes Int4, saving 22.27% for that array group.
- Whole Soul fixture: 36,760 bytes.

This is storage/quantisation fidelity, not playing strength. The policy top move changed in 5.16% of sampled positions, so exact action preservation is not guaranteed.

## 4. Tactical policy-retention experiment

Runner: `benchmarks/v6-tactical-retention.js`  
Dataset: `benchmarks/data/mate-in-one-50.json`  
Report: `benchmarks/results/v13-tactical-retention-50x100.json`

Protocol:

1. Verify 50 positions whose designated legal move produces immediate checkmate.
2. Score the policy ranking before training.
3. Train on the 50-position curriculum for 20 epochs.
4. Run 100 random-legal self-play interference episodes, alternating the pet's colour, capped at 20 plies per episode.
5. Use the real observe → delayed outcome resolution → practice reinforcement path; standard replay is applied in deterministic five-episode batches for benchmark runtime.
6. Score the same 50 puzzle positions again.

Results:

| Measure | Before curriculum | After curriculum | After interference |
|---|---:|---:|---:|
| Policy top-1 recall | 4% | 52% | 52% |
| Mean reciprocal rank | 0.1250 | 0.6702 | 0.6638 |
| Mean target probability | 0.0272 | 0.2392 | 0.2406 |

Relative retention after interference versus immediately after curriculum:

- Top-1 recall ratio: **100%**.
- MRR retention ratio: **99.05%**.
- The provisional 85% *episode-level* retention gate is met for this one seed and this exact protocol.
- Absolute recall after learning is 52%; the pet still fails to rank the forced mate first in 24 of 50 positions.

**Critical limitations:** all 100 interference episodes reached the artificial 20-ply horizon; zero terminal games completed. This does **not** satisfy Qwen's proposed threshold of 85% retention after 50 completed games. It measures policy ranking on fixed mate-in-one positions, not multi-move tactics, generalisation or chess-playing strength. One seed is insufficient for a broad retention claim.

Storage after this run: **50,297 / 51,200 bytes**, 903 bytes remaining, 6 position-memory entries, 160 replay entries and no pending items. This is still a Free storage-pressure warning.

## 5. Chess-strength benchmark status

The frozen chess benchmark supports training, frozen evaluation, held-out opening starts, equal search budgets, policy on/off and resumable progress reports. The CI `--smoke=1` mode is a one-game/four-ply wiring test only. Its horizon draw is expected and it must not be included in strength statistics.

A meaningful strength result still requires:

- completed games, with horizon games reported separately;
- multiple deterministic seeds and colour swaps;
- fresh V13, trained V13, frozen V5 and diverse opponent styles;
- equal time and node budgets;
- held-out opening families and test positions;
- policy-on/off ablation;
- uncertainty intervals and device/runtime details.

**Current verdict:** V13's WDL and policy heads can learn controlled synthetic targets, the mate-in-one policy improves on its fixed curriculum, and that narrow improvement survived 100 short interference episodes. No controlled test yet proves stronger general chess play or long-term retention after 50 completed games.
