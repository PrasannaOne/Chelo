# Chelo V15-CPP M6: C++-First Companion + Episodic Personality

## Scope

M6 makes the existing C++20/WebAssembly engine the default engine for local adaptive companion games, adds a dual-bounded search ABI, and gives each pet a compact persistent match-memory trail with more expressive trait combinations. It preserves the V37 shared checkpoint and the single `.chelo` save contract.

## C++/V37 gameplay integration

- Normal `mode: adaptive` Worker requests now select the C++/WASM engine automatically. The app also explicitly requests the C++ path. The verified Polyglot book remains in front of the search, so a legal opening-book hit is returned without starting a tree search.
- The Worker loads the shared V37 binary, verifies its SHA-256 (`f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`), then loads each pet's separate compact Bond and Arena adapters into the C++ evaluator.
- Added `chelo_search_limited(depth, timeMs, nodeLimit)` to the C++/WASM bridge. Adaptive search now stops at whichever limit is reached first: personalised node budget or time budget. The reported `nodes` count includes both normal search nodes and quiescence nodes.
- Existing `chelo_search` and `chelo_search_nodes` APIs remain available. The new entry point preserves fixed-node determinism when the time cap is not binding.
- Rated/PvP/companion fairness modes remain on their existing fixed-budget path. This M6 change applies to local adaptive companion play, not ranked fairness.
- If C++/WASM cannot load, the Worker retains the JavaScript safety fallback and reports `engineFallback` plus a reason. The app labels this state instead of silently presenting it as C++.

## Persistent personality and episodic memories

- Pet traits remain the compact `bold`, `curious`, and `patient` dimensions, but their combinations now produce a richer set of behavioural descriptions.
- Completed trainer matches create a small event memory: tactical victory, ordinary victory, tactical lesson, ordinary defeat, draw, or long-game draw.
- At most 12 recent life memories are retained. They are encoded as compact numeric tuples under the optional `e` field of the existing V16 pet record, avoiding a schema bump and preserving compatibility with older V16 records (older readers may ignore this extension).
- Memories include day, game length, tactical-move count and dominant trait snapshot. Human-readable summaries are generated at runtime rather than storing repeated prose.
- The recent memory is visible in the pet's growing-brain panel and survives `.chelo` export/import.

## Arena learning integrity

- Trainer games continue to update Bond only.
- The generic `reinforce(..., {layer:'arena'})` route is now refused with `arena-attestation-required` so an ordinary client-supplied game cannot accidentally contaminate Arena learning.
- The current online Arena endpoint verifies legal move replay only. It does not prove that the opponent pet generated its submitted moves. Its response now explicitly reports `arenaLearningAllowed: false`.
- The Arena adapter remains part of the compact pet save and the C++ evaluator, but online Arena outcomes are **not** automatically trained in M6. A server-verifiable AI-move attestation mechanism is still required before that can be enabled safely.

## Strength calibration boundary

- The adaptive profile remains an internal challenge estimate from 100 to 2,400, not a certified chess Elo.
- M6 verifies that node, time and depth budgets increase monotonically with the internal challenge estimate and that C++ gameplay obeys the supplied caps.
- No human-skill calibration, Android-device latency study, or external-engine Elo gauntlet was completed in this milestone. The challenge curve remains provisional and no playing-strength gain is claimed.

## Storage and frozen assets

- The unified `.chelo` contract is unchanged: Free whole-file limit 100 KiB; Pro supports five 500 KiB pet records plus shared/container allowance.
- New event memories use the existing V16 compact pet record extension. Storage audit and round-trip tests continue to enforce the byte limits.
- `models/dual-nnue-v37.bin` remains 49,368 bytes with the exact frozen SHA-256 above. No model retraining or weight changes were made.

## Verification

M6 targeted checks:

- Adaptive Worker path uses the Polyglot book for legal opening hits, then C++/V37 by default; a deterministic fixture verifies an exact 900-node budget. A separate 10 ms adaptive fixture confirms the C++ time ceiling is also active.
- Combined time+node search returns the same fixed-node result as the existing node-only API when the time limit is non-binding.
- Native/WASM fixed-node parity, position evaluation parity with non-zero Bond/Arena tensors, incremental NNUE/hash checks, SEE/attack parity and special-transition tests remain in place.
- Bond-only trainer reinforcement, rejection of unattested Arena reinforcement, memory creation and `.chelo` memory round-trip are covered.
- Free/Pro byte ceilings, migration, corruption and entitlement checks remain covered by the existing save-format suite.
- `run-tests.sh`, `run-learning-tests.sh`, `run-nnue-tests.sh`, `run-search-tests.sh`, the three tactical tests, `run-worker-tests.sh`, native C++ verification, C++ parity, and WASM parity were run successfully in separate groups. The combined `run-m6-tests.sh` command exceeded this environment’s 120-second command window, so its slower tactical steps were executed separately.

Real Android/Termux thermal and latency measurements remain outstanding. Cloudflare deployment, account UI, and authenticated player sync are also outside this milestone.
