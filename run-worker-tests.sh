#!/bin/sh
set -eu
node tests/worker.test.js
node workers/arena/tests/worker.test.mjs
node workers/arena/tests/player-save-do.test.mjs
python3 tests/arena_schema.test.py
