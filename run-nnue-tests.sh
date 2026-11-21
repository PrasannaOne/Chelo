#!/bin/sh
set -eu
node tests/dual-nnue.test.js
node tests/stage37-binary-integrity.test.js
node tests/stage37-chelo-adapter-parity.test.js
python3 benchmarks/verify-stage37-results.py
