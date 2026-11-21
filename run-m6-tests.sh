#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash ./build_termux.sh
bash ./build_wasm.sh
./bin/chelo-uci --verify
bash ./run-tests.sh
bash ./run-learning-tests.sh
bash ./run-nnue-tests.sh
bash ./run-search-tests.sh
bash ./run-tactical-tests.sh
bash ./run-worker-tests.sh
bash ./run-m8-engine-tests.sh
node ./tests/worker.test.js
printf '\nChelo M8 engine + M6 companion validation complete.\n'
