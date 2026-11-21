# Chelo V15-CPP M3 Release Report

## Scope
M3 is a focused Soul-export correctness and reference-documentation milestone built on the complete M2 archive. It does not change the C++ search algorithm, V37 model, Bond/Arena adapter tensor layout, or gameplay UI.

## Changes
1. `src/soul/brain.js`: full V15 Soul export now emits minified JSON and checks the exact UTF-8 byte length of the complete output, including the envelope and optional active-match data. Exports exceeding the current plan's limit fail explicitly.
2. `tests/chelo-size-audit.test.js (M4 replacement)`: deterministic real-runtime stress audit using the actual V15 brain, checkpoint, and V37 model. It verifies Free/Pro file caps and Bond/Arena import/export round trips.
3. `docs/SOUL-SIZE-AUDIT.md` and `docs/SOUL-SIZE-AUDIT-RESULTS.json`: method and measured results.
4. `reference/UI-REFERENCE-CHECKLIST.md`: historical UI ideas filtered through current Chelo product direction. No UI code changed.
5. `tests/tactical-mate-one.test.js`: corrected the Stage 3.6 reference-model path to match the archive's actual `models/` subdirectory.
6. `sw.js`: advanced cache namespace to `chelo-shell-v20-stage15cpp-m3` so deployed clients fetch the updated Soul exporter.

## Soul file measurements

| Plan | Limit | Fresh export | Saturated synthetic export | Positions retained |
|---|---:|---:|---:|---:|
| Free | 51,200 B | 37,557 B | 50,509 B | 143 |
| Pro | 512,000 B | 37,556 B | 501,853 B | 5,129 |

The saturated fixtures passed exact byte-cap assertions and adapter round-trip checks. Position counts are fixture-specific and are not guaranteed for arbitrary real game histories.

## Verification

Passed:
- `bash run-tests.sh`
- `bash run-cpp-m2-tests.sh`
- `bash run-worker-tests.sh`
- `bash run-learning-tests.sh`
- `bash run-nnue-tests.sh`
- `bash run-tactical-tests.sh`
- `node tests/engine-hardening.test.js`
- `node tests/fast-search.test.js`

The tactical suite initially exposed a stale file path in its Stage 3.6 fixture loader; the path was corrected and the suite then passed. The search hardening and fast-search tests were also run individually and passed.

## Frozen model verification

`models/dual-nnue-v37.bin` remains **49,368 bytes** with SHA-256:

`f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`

## Non-claims / remaining checks

- No new Elo claim is made; M3 changes serialization only.
- No UI redesign was performed.
- The Soul-size position counts are synthetic-fixture measurements, not universal real-world capacities.
- Physical Android/Termux performance and deployment validation remain separate device-side checks.
