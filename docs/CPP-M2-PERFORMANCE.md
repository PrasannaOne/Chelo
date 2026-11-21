# Chelo V15-CPP M2 performance note

## Benchmark setup

- Environment: Linux x86_64 sandbox, Clang 17, AMD EPYC 9V74 host.
- M1 binary: `Chelo-V15-CPP-M1/bin/chelo-uci`.
- M2 binary: `Chelo-V15-CPP-M2/bin/chelo-uci`.
- Position: `startpos moves e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3`.
- Each run used UCI `go movetime`; timing started after engine startup/model load and UCI handshake.
- Warmed comparison: five 500 ms runs per binary and three 3,000 ms runs per binary.
- M1 reports all search visits in `nodes`; M2 reports `nodes` and `qnodes` separately. Total visits are compared as M1 `nodes` versus M2 `nodes + qnodes`.

## Results

The runs were interleaved M1/M2 to reduce order and thermal bias. M1 reports all search visits in `nodes`; M2 reports `nodes` and `qnodes` separately, summed here.

| Budget | Repetitions | M1 median NPS | M2 median NPS | Change | Completed depth |
|---:|---:|---:|---:|---:|---|
| 500 ms | 5 | 751,184 | 787,462 | +4.83% | 3 / 3 |
| 3,000 ms | 3 | 719,203 | 731,600 | +1.72% | 3 / 3 |

All runs completed depth 3 and returned `h8g8`, score +15 cp on this position. M2 did **not** complete a deeper ply in these time windows. The difference is a modest throughput improvement, not a playing-strength result. Full per-run values are in `CPP-M2-BENCHMARK-RESULTS.json`.

## Interpretation and limits

M2's incremental NNUE/hash work, bitboard piece iteration and attack/SEE optimizations show a modest throughput improvement on this single x86_64 host workload. The measured gain is smaller at three seconds than at 500 ms, and a single one-run sample varied enough to reverse the apparent difference. These measurements are noisy and are not representative of Android ARM64 automatically.

No match/gauntlet tests were run and no Elo gain is claimed. The Termux build script is included, but physical-device compilation, latency, thermals and sustained performance still require testing on the target Android device. Browser WASM parity tests currently run under the sandbox's Node/V8 runtime; actual mobile-browser validation remains outstanding.

## Reproduction

With an M1 binary available beside the M2 project:

```sh
python3 tools/benchmark-cpp-m2.py \\
  --baseline ../Chelo-V15-CPP-M1/bin/chelo-uci \\
  --current ./bin/chelo-uci \\
  --repetitions 5
```

The script compares 500 ms and 3,000 ms budgets and emits the per-run depth, node counts, NPS, score and best move as JSON. It is a single-position engine throughput check, not a UCI game match.
