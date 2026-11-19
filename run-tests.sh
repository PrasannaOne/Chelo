#!/bin/sh
set -eu
node tests/smoke.test.js
node tests/learning.test.js
node tests/worker.test.js
node arena/worker.test.mjs
