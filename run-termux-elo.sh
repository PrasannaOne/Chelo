#!/data/data/com.termux/files/usr/bin/bash
# Usage: ./run-termux-elo.sh /path/to/opponent-uci-engine [games] [movetime-ms] [opponent-elo]
set -euo pipefail
cd "$(dirname "$0")"
if [[ $# -lt 1 ]]; then
  echo 'Usage: ./run-termux-elo.sh /path/to/opponent-uci-engine [games=60] [movetime-ms=500] [opponent-elo]' 
  echo 'Example: ./run-termux-elo.sh ../tomitankChess/tomitankChessUCI.js 60 500'
  exit 2
fi
OPPONENT="$1"
GAMES="${2:-60}"
MOVETIME="${3:-500}"
OPPONENT_ELO="${4:-}"
bash ./build_termux.sh
./bin/chelo-uci --verify
ARGS=(--chelo ./bin/chelo-uci --opponent "$OPPONENT" --games "$GAMES" --movetime "$MOVETIME")
if [[ -n "$OPPONENT_ELO" ]]; then ARGS+=(--opponent-elo "$OPPONENT_ELO"); fi
node ./tests/uci-gauntlet.js "${ARGS[@]}"
