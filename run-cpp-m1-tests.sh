#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash ./build_termux.sh
bash ./build_wasm.sh
./bin/chelo-uci --verify
node ./tests/cpp-parity.test.js
node ./tests/cpp-wasm.test.js
node --check ./src/worker/ai-worker.js
node ./tests/worker.test.js
node ./tests/stage37-binary-integrity.test.js
node ./tests/stage37-chelo-adapter-parity.test.js
