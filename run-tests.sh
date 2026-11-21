#!/bin/sh
set -eu
node --check src/engine/chess.js
node --check src/engine/fast-search.js
node --check src/engine/endgame-kpk.js
node --check src/nnue/dual-nnue.js
node --check src/soul/brain.js
node --check src/worker/ai-worker.js
node --check src/app/app.js
node --check workers/arena/worker.mjs
python3 -m py_compile training/train_nnue.py tools/generate-kpk-bitbase.py benchmarks/verify-stage37-results.py
node tests/smoke.test.js
node tests/v6-engine.test.js
node tests/repository-layout.test.js
node tests/chelo-size-audit.test.js
node tests/chelo-format.test.js
