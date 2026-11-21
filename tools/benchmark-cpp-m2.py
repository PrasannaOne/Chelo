#!/usr/bin/env python3
"""Compare an M1 UCI binary with this M2 binary on one fixed FEN/move list.

Example:
  python3 tools/benchmark-cpp-m2.py \
    --baseline ../Chelo-V15-CPP-M1/bin/chelo-uci \
    --current ./bin/chelo-uci --repetitions 5

This is a throughput benchmark only, not a playing-strength test.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import statistics
import subprocess
import time
from pathlib import Path

POSITION = "position startpos moves e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3"


def run_once(binary: Path, milliseconds: int) -> dict:
    binary = binary.resolve()
    cwd = binary.parent.parent
    proc = subprocess.Popen(
        [str(binary)], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, bufsize=1,
    )

    def send(command: str) -> None:
        assert proc.stdin is not None
        proc.stdin.write(command + "\n")
        proc.stdin.flush()

    try:
        send("uci")
        while True:
            line = proc.stdout.readline()  # type: ignore[union-attr]
            if not line:
                raise RuntimeError(f"{binary} exited during UCI handshake")
            if line.strip() == "uciok":
                break
        send("isready")
        while proc.stdout.readline().strip() != "readyok":  # type: ignore[union-attr]
            pass
        send("ucinewgame")
        send(POSITION)
        started = time.perf_counter()
        send(f"go movetime {milliseconds}")
        info = ""
        bestmove = ""
        while True:
            line = proc.stdout.readline()  # type: ignore[union-attr]
            if not line:
                raise RuntimeError(f"{binary} exited before bestmove")
            if line.startswith("info depth "):
                info = line.strip()
            elif line.startswith("bestmove "):
                bestmove = line.strip().split()[1]
                break
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        match = re.search(
            r"info depth (\d+) nodes (\d+)(?: qnodes (\d+))? score cp (-?\d+)",
            info,
        )
        if not match:
            raise RuntimeError(f"Could not parse final info line from {binary}: {info!r}")
        depth, main_nodes, qnodes, score = match.groups()
        # M1 reports main + qsearch visits together in `nodes`; M2 splits qnodes.
        main_nodes_i = int(main_nodes)
        qnodes_i = int(qnodes or 0)
        total_nodes = main_nodes_i + qnodes_i
        return {
            "elapsed_ms": round(elapsed_ms, 1),
            "depth": int(depth),
            "main_nodes_reported": main_nodes_i,
            "qnodes_reported": qnodes_i,
            "total_nodes": total_nodes,
            "nps": round(total_nodes / (elapsed_ms / 1000.0)),
            "score_cp": int(score),
            "bestmove": bestmove,
        }
    finally:
        try:
            send("quit")
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def summarize(binary: Path, milliseconds: int, repetitions: int) -> dict:
    runs = [run_once(binary, milliseconds) for _ in range(repetitions)]
    return {
        "binary": str(binary),
        "runs": runs,
        "median_nps": int(statistics.median(x["nps"] for x in runs)),
        "median_depth": statistics.median(x["depth"] for x in runs),
        "median_total_nodes": int(statistics.median(x["total_nodes"] for x in runs)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path, help="M1 UCI binary")
    parser.add_argument("--current", type=Path, default=Path("bin/chelo-uci"), help="M2 UCI binary")
    parser.add_argument("--repetitions", type=int, default=5, help="500 ms samples per engine")
    parser.add_argument("--long-repetitions", type=int, default=3, help="3,000 ms samples per engine")
    args = parser.parse_args()
    if args.repetitions < 1 or args.long_repetitions < 1:
        parser.error("repetition counts must be >= 1")
    for binary in (args.baseline, args.current):
        if not binary.is_file():
            parser.error(f"engine binary not found: {binary}")
    paths = {"m1": args.baseline, "m2": args.current}
    result = {"position": POSITION, "comparison": {}, "method": "M1/M2 runs are interleaved to reduce order/thermal bias; M1 reports qsearch in nodes, M2 reports qnodes separately."}
    for milliseconds, repetitions in ((500, args.repetitions), (3000, args.long_repetitions)):
        runs = {"m1": [], "m2": []}
        for i in range(repetitions):
            order = ("m1", "m2") if i % 2 == 0 else ("m2", "m1")
            for name in order:
                runs[name].append(run_once(paths[name], milliseconds))
        summary = {}
        for name in ("m1", "m2"):
            vals = runs[name]
            summary[name] = {
                "binary": str(paths[name]),
                "runs": vals,
                "median_nps": int(statistics.median(x["nps"] for x in vals)),
                "median_depth": statistics.median(x["depth"] for x in vals),
                "median_total_nodes": int(statistics.median(x["total_nodes"] for x in vals)),
            }
        improvement = (summary["m2"]["median_nps"] / summary["m1"]["median_nps"] - 1.0) * 100.0
        result["comparison"][str(milliseconds)] = {
            **summary,
            "median_nps_change_percent": round(improvement, 2),
        }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
