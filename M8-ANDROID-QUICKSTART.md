# Chelo M8: Android / Termux build and benchmark

This guide is for the native chess engine only. M8 does not change the pet, Bond/Arena learning or `.chelo` saves.

## Build and verify on Android

Install the native compiler and Node.js if needed, then run:

```sh
pkg update
pkg install clang nodejs
cd Chelo-V15-CPP-M8
bash build_termux.sh
./bin/chelo-uci --verify
```

The Android/Termux Clang compiler targets the phone's ARM64 environment. A build performed on a desktop/container is a host build, not an Android benchmark.

## Native device throughput

```sh
CHELO_BENCH_RUNS=3 CHELO_BENCH_NODES=500000 bash benchmarks/termux-benchmark.sh
```

This records device/SOC details where available, toolchain versions, perft-5, and median NPS/depth across five positions. Run the phone cool, with heavy background applications closed, and avoid charging/thermal throttling during measurements.

## WebAssembly on the same phone

Build the static site, serve it locally, then open `benchmarks/wasm-device-benchmark.html` in Android Chrome or the target WebView. It measures the browser's WebAssembly runtime, which should be recorded separately from the native Termux result.

## External UCI match

The runner supports a native UCI executable or a Node.js UCI script. The standard Stockfish setup can be used as before:

```sh
./run-termux-elo.sh ../Stockfish/src/stockfish 200 500 2100
```

The last argument enables Stockfish's `UCI_LimitStrength` and `UCI_Elo` options. Stockfish's 2100 limiter is approximate, not a certified rating. The gauntlet pairs openings and reverses colours; engines advertising `Move Overhead` are set to zero overhead for the comparison.

Use at least 200 games for an initial estimate, and more when the score is close. A short match is only a smoke test. Do not compare absolute NPS measured on different devices or label relative Elo difference as a FIDE rating.

## M8 engine regression suite

```sh
bash run-m8-engine-tests.sh
```

This rebuilds native and WebAssembly targets and runs perft, V37/adapter parity, position-identity and insufficient-material rules, path-sensitive root move retention, tactical mate, UCI time management and WASM parity tests.

## Result boundaries

- NPS measures throughput, not playing strength.
- Fixed-node depth is useful diagnostic evidence, not Elo.
- A 2100-limited Stockfish setting is an opponent-strength approximation.
- Do not declare M8 stronger than Stage 3.9 until a matched, sufficiently large paired match completes on the target Android device.
