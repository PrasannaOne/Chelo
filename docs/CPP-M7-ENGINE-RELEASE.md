# Chelo V15-CPP M7: Bitboard Move Generation, Tactical Search and Device Benchmarks

## Scope

M7 is an engine-core milestone based on the M6 source tree. It changes the native C++20 and shared WASM engine while preserving the V37 weights, adapter wire format, `.chelo` contract, and M6 gameplay integration.

## Engine changes

### Bitboard move generation

- Precompute eight directional rays, knight masks, king masks, and reverse pawn-attack masks for all 64 squares.
- Replace the mailbox/ray-walk slider move generator with bitboard rook, bishop, and queen attacks. The nearest blocker is selected from the occupied-ray mask, then squares beyond that blocker are removed.
- Use precomputed leaper attack masks and occupancy masks when emitting legal pseudo-moves.
- Keep pawn edge cases explicit: single/double pushes, four promotion choices, captures, en passant, and castling.
- Reuse the bitboard slider attacks in king-attack detection. The retained reference attack routine remains available for deterministic parity checks.
- Include quiet promotions in quiescence capture generation so a promotion threat is not accidentally hidden at the leaf.

### Tactical search

- Extend the normal quiescence capture horizon from 5 to 8 plies.
- Add a queen-value delta bound with a safety margin and conservative static-exchange pruning for clearly losing non-promotion captures. Checking sacrifices are exempt from the losing-capture prune.
- Retain iterative deepening, aspiration windows, PVS, null-move pruning, LMR, TT replacement, killers, history and continuation history.
- Preserve the static V37 evaluator. No model training or weight edits were made.

### Time management and UCI

- `Engine::search` now performs a low-cost root mate-in-one preflight before iterative deepening, then supports a soft iteration-stop time separately from the hard deadline and node cap.
- Hard deadline polling is performed every 256 combined main-search and quiescence nodes.
- Native UCI accepts `movetime`, `wtime`, `btime`, `winc`, `binc`, `movestogo`, `depth`, and `nodes`.
- Time controls reserve configurable Move Overhead (default 30 ms), allocate a soft budget, and retain a larger hard safety ceiling.
- `Bond_LoRA` and `Arena_LoRA` UCI file options remain supported for adapter-aware test and match parity.
- `perft`, `divide`, `eval`, attack/SEE parity and incremental-state verification commands are available for diagnostics.
- UCI search is synchronous. `stop` cannot interrupt an in-progress native search; searches terminate from their movetime/clock/node/depth limits. The provided gauntlet uses bounded `movetime` and does not depend on asynchronous stop.

## Build and use on Android / Termux

Install Termux packages:

```sh
pkg update
pkg install clang nodejs
```

Build the native Android executable:

```sh
bash build_termux.sh
./bin/chelo-uci --verify
```

The native Termux build no longer attempts a WebAssembly target. This avoids requiring a WASM linker in the Android native toolchain. Browser/WASM builds are separate:

```sh
bash build_wasm.sh
```

## Termux native benchmark

Run on the Android device itself:

```sh
bash benchmarks/termux-benchmark.sh
```

The report records Android model/SOC/API metadata where exposed by `getprop`, Termux/Node/Clang versions, perft-5 correctness, and repeated fixed-node NPS over start, Kiwipete, rook endgame, promotion-tactical and middlegame positions. Defaults are 3 runs × 500,000 combined search + quiescence nodes per position. Adjust with `CHELO_BENCH_RUNS` and `CHELO_BENCH_NODES`.

For browser/WebView WASM measurements, deploy the updated site or serve the repository root over HTTP, then open:

`benchmarks/wasm-device-benchmark.html`

It loads the pinned V37 model and benchmarks perft-5 and fixed-node search on that actual browser device. The report includes user-agent, hardware concurrency, device-memory hint and the measured WASM results. Do not use desktop Node results as a substitute for an Android browser benchmark.

## UCI Elo gauntlet

The UCI gauntlet now accepts native executables or Node UCI scripts:

```sh
./run-termux-elo.sh ../tomitankChess/tomitankChessUCI.js 60 500
```

Arguments are opponent path, game count (default 60), and per-move time in milliseconds (default 500). The runner plays colour-swapped opening pairs and reports W/L/D, score percentage, estimated Elo difference versus that opponent, and an approximate 95% sampling interval. A native opponent executable can be passed in exactly the same way.

This is **relative Elo difference**, not an absolute FIDE/USCF rating. Keep hardware, engine versions, opening set and time controls fixed when comparing releases. Sixty games are a smoke-level estimate; use 200–500+ games for a more stable comparison. Run both engines on the same Termux device and avoid thermal throttling.

## Validation completed in the build environment

- Native `--verify`: start position perft-4 = 197,281; Kiwipete perft-3 = 97,862; attack parity, SEE parity, special transitions, incremental NNUE and Zobrist checks passed.
- Native perft corpus: six standard positions passed, including start perft-5 = 4,865,609, Kiwipete, positions 3–6.
- Native tactical retention: 50/50 mate-in-one positions found at 8,000 nodes each, with zero illegal moves.
- Native/WASM fixed-node search: bit-identical results with non-zero Bond and Arena adapters.
- WASM parity: extra perft positions, attack/SEE parity, model/evaluation, adapter, special-transition and managed-time tests passed.
- UCI time tests: movetime, clock allocation and exact fixed-node cap passed.
- Existing core, save-format, learning, NNUE, worker, Arena, search and tactical regression suites were run in separate groups and passed.
- UCI harness smoke test: 2 colour-swapped games completed as draws against the existing JS UCI implementation. The estimated +0.0 Elo with a roughly ±481.5 Elo 95% sampling range is only a protocol smoke test, not a meaningful rating.

## Development-host performance sample (not Android)

A three-run, 250,000-node-per-position process-level comparison against the M6 native binary showed the following median search NPS on an AMD EPYC 9V74 x86-64 host:

| Position | M6 NPS | M7 NPS | Difference |
|---|---:|---:|---:|
| Start | 958,868 | 1,300,083 | +35.6% |
| Kiwipete | 839,129 | 962,068 | +14.7% |
| Rook endgame | 1,103,186 | 1,303,804 | +18.2% |
| Promotion tactics | 694,430 | 933,977 | +34.5% |
| Middlegame | 937,996 | 1,175,894 | +25.4% |

These are throughput observations, not Elo gains. Search depth at the same node count changed by position because the M7 quiescence horizon is longer. No actual Android hardware measurement or full M7-versus-Tomitank Elo gauntlet has been run from this environment; use the supplied Termux scripts for those measurements. A final one-run 100,000-node smoke benchmark on this same Linux host reported 0.96–1.47 million NPS across five positions; this is a tool check, not an Android result or an Elo measurement.

## Frozen assets and compatibility

- V37 NNUE remains 49,368 bytes with SHA-256 `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`.
- No edits to the model binary, V14 base JSON, Bond/Arena encoding, `.chelo` container, or pet memory records.
- The browser engine ABI is extended with `chelo_search_managed(depth, softMs, hardMs, nodeLimit)`; existing search exports remain available.
- Service-worker cache key is bumped to `chelo-shell-v24-stage15cpp-m7-bitboard-search` so installed devices fetch the updated WASM engine.
