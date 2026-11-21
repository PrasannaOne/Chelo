#!/bin/sh
set -eu
node tests/tt-collision.test.js
node tests/tactical-mate-one.test.js
node tests/time-budget.test.js
