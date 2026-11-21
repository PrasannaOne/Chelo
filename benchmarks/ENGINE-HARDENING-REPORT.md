# Chelo V14 engine hardening benchmark

Created: 2026-11-19T10:22:57.255Z

## Frozen checkpoint

- SHA-256: `309fe09cf69f41efb5f0faaba47b63543c420c2b1098684dbd8f6e9e90be6d28`
- Unchanged after benchmark: **yes**

## 150 ms NPS comparison

| Path | Median NPS | Median depth | P25–P75 NPS |
|---|---:|---:|---:|
| Full first-layer recompute | 11,424 | 2 | 9,227–11,987 |
| Incremental Float32 accumulator | 12,530 | 1.5 | 9,313–14,847 |

Median NPS change: **+9.7%**. Identical held-out positions, model, 150 ms budget, move-ordering/search configuration; book disabled.

## Held-out tactical test

| Set | Sample | Exact first-solution-move hits | Rate | Median depth |
|---|---:|---:|---:|---:|
| Mate in 2 | 20 | 11 | 55.0% | 2 |
| Mate in 3 | 20 | 5 | 25.0% | 1 |

Lichess stores the FEN before the opponent's last move; therefore the benchmark first replays `moves[0]` and evaluates from that resulting puzzle position against `moves[1]`. This follows the official dataset description. An exact hit is agreement with the puzzle's first solution move, not proof that every alternative forced mate is missed.

### Forced-mate proof search (600 ms per position)

- Mate in 2: 7/10 strictly solved (7 positions produced a positive forced-mate score).
- Mate in 3: 4/10 strictly solved (4 positions produced a positive forced-mate score).

A solve requires both a positive forced-mate score >= 29,000 and the expected first solution move. This intentionally strict criterion avoids counting a guessed move as a proved mate.

## Limitations

- The benchmark is a local Node.js engine test, not a browser/mobile thermal benchmark.
- A strict first-solution-move hit rate can undercount equivalent mating moves not present in the puzzle line.
- A 150 ms cap may not complete the full forced-mate horizon on every position.
- The 20 KiB book is a deterministic legal rollout starter book, not an expert or tournament repertoire.
