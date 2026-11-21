#!/bin/sh
set -eu
node --trace-gc --trace-deopt tests/runtime-profile.js > benchmarks/results/STAGE38-V8-PROFILE-TRACE.txt 2>&1
python3 tests/summarize-v8-profile.py
