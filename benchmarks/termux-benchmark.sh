#!/data/data/com.termux/files/usr/bin/bash
# Native performance and correctness profile for the actual Android device.
set -euo pipefail
cd "$(dirname "$0")/.."

printf '\n=== CHELO ANDROID / TERMUX BENCHMARK ===\n'
printf 'Date: '; date
printf '\n-- Device --\n'
uname -a
for key in ro.product.manufacturer ro.product.model ro.soc.model ro.build.version.release ro.build.version.sdk; do
  value="$(getprop "$key" 2>/dev/null || true)"
  [[ -n "$value" ]] && printf '%s: %s\n' "$key" "$value"
done
printf '\n-- Toolchain --\n'
node --version
clang++ --version | head -n 1

printf '\n-- Native build --\n'
bash ./build_termux.sh
printf '\n-- Engine correctness --\n'
./bin/chelo-uci --verify
printf '\n-- Warm-up and measured search --\n'
node ./tests/device-benchmark.js --engine ./bin/chelo-uci --runs "${CHELO_BENCH_RUNS:-3}" --nodes "${CHELO_BENCH_NODES:-500000}"
