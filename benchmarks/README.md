# Chessling frozen-brain A/B benchmark

This tool compares two saved Souls with the same Chessling V4 source, hardware, time limit, node limit and rotating opening set. It alternates the candidate's colour. Models are frozen during the games: this isolates the strength of the saved brain rather than mixing evaluation with online training during the benchmark.

## Run

```bash
node benchmarks/duel.js baseline-soul.json trained-soul.json 100 120 8000 140
```

Use `-` in either Soul position to load a fresh, untrained V4 brain:

```bash
node benchmarks/duel.js - trained-soul.json 100 120 8000 140
```

Arguments are: baseline Soul path, candidate Soul path, number of games, milliseconds per move, node limit per move, and maximum plies per game. Both Soul paths may be `-`. Defaults are 10 games, 120 ms, 8,000 nodes and 140 plies. The script never trains either brain and it does not change saved files.

## How to interpret it

- The candidate alternates between White and Black.
- Openings rotate across the standard start and several legal opening positions.
- Games reaching the ply cap are recorded as capped draws and are also counted separately.
- The runner prints points, W/L/D, average nodes and average completed depth.
- A handful of games is only a smoke check. For a meaningful claim, run hundreds or thousands of games where practical, use more opening seeds, keep test positions untouched during tuning, and calculate confidence intervals.
- This runner compares two V4 brains under one engine build. A V3 code-level baseline requires separately preserving and running the V3 engine, not merely importing a V3 Soul into V4.
- It does not produce an official Elo rating and cannot by itself establish broad chess strength.
