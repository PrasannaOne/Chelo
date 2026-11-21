#!/bin/sh
set -eu
node tests/engine-hardening.test.js
node tests/fast-search.test.js
