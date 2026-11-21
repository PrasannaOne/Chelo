#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

bash ./build_termux.sh
bash ./build_wasm.sh
./bin/chelo-uci --verify
node ./tests/cpp-engine-rules.test.js
node ./tests/cpp-perft.test.js
node ./tests/cpp-parity.test.js
node ./tests/uci-time-management.test.js
node ./tests/cpp-tactical-mate-one.test.js
node ./tests/cpp-wasm.test.js
printf '\nChelo M8 native/WASM engine regression suite: PASS\n'
