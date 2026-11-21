#!/data/data/com.termux/files/usr/bin/bash
# Native Android/Termux build. WebAssembly is deliberately a separate build target.
set -euo pipefail
cd "$(dirname "$0")"
CXX="${CXX:-clang++}"
mkdir -p bin
COMMON=(-O3 -std=c++20 -DNDEBUG -fno-exceptions -fno-rtti -Wall -Wextra)
"$CXX" "${COMMON[@]}" cpp/chelo_engine.cpp cpp/uci_main.cpp -o bin/chelo-uci
printf 'Built native C++ engine: %s/bin/chelo-uci\n' "$PWD"
printf 'Run verification: ./bin/chelo-uci --verify\n'
if [[ "${1:-}" == "--wasm" || "${CHELO_BUILD_WASM:-0}" == "1" ]]; then
  bash ./build_wasm.sh
fi
