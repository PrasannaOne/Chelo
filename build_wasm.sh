#!/usr/bin/env bash
# Build the shared browser/WebAssembly engine. Run on a host toolchain with wasm32 support.
set -euo pipefail
cd "$(dirname "$0")"
CXX="${WASM_CXX:-clang++}"
mkdir -p wasm
"$CXX" --target=wasm32 -fuse-ld=lld -O3 -std=c++20 -nostdlib -fno-exceptions -fno-rtti -fno-builtin \
  cpp/chelo_engine.cpp cpp/wasm_exports.cpp -Wl,--no-entry -Wl,--export-dynamic -Wl,--export-memory \
  -Wl,--allow-undefined -Wl,--export=__wasm_call_ctors -Wl,--initial-memory=33554432 -Wl,--max-memory=134217728 \
  -Wl,--export=chelo_abi_version -Wl,--export=chelo_model_buffer -Wl,--export=chelo_model_buffer_size \
  -Wl,--export=chelo_kpk_buffer -Wl,--export=chelo_fen_buffer -Wl,--export=chelo_load_kpk \
  -Wl,--export=chelo_adapter_buffer -Wl,--export=chelo_adapter_buffer_size -Wl,--export=chelo_load_model \
  -Wl,--export=chelo_load_adapter -Wl,--export=chelo_set_fen -Wl,--export=chelo_perft \
  -Wl,--export=chelo_evaluate -Wl,--export=chelo_search -Wl,--export=chelo_search_nodes -Wl,--export=chelo_search_limited \
  -Wl,--export=chelo_search_managed -Wl,--export=chelo_bestmove_text -Wl,--export=chelo_clear_hash -Wl,--export=chelo_new_game \
  -Wl,--export=chelo_verify_incremental -Wl,--export=chelo_verify_hash -Wl,--export=chelo_verify_see \
  -Wl,--export=chelo_verify_attack -Wl,--export=chelo_verify_special_transitions -o wasm/chelo.wasm
printf 'Built WebAssembly engine: %s/wasm/chelo.wasm\n' "$PWD"
