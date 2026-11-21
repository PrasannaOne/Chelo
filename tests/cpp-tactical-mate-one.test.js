'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'src/engine/chess.js'));
const Chess = globalThis.ChessCore;
const set = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/data/mate-in-one-50.json'), 'utf8'));
const lines = [];
for (const puzzle of set.puzzles) {
  lines.push('ucinewgame', `position fen ${puzzle.fen}`, 'go nodes 8000');
}
lines.push('quit', '');
const run = spawnSync(path.join(root, 'bin/chelo-uci'), [], {
  cwd: root, input: lines.join('\n'), encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024
});
assert.equal(run.status, 0, run.stderr);
const moves = [...run.stdout.matchAll(/^bestmove\s+(\S+)/gm)].map(x => x[1]);
assert.equal(moves.length, set.puzzles.length, `expected ${set.puzzles.length} engine results, got ${moves.length}`);
let mates = 0, illegal = 0;
for (let i = 0; i < set.puzzles.length; i++) {
  const game = new Chess(set.puzzles[i].fen);
  if (!game.move(moves[i], { skipSan: true })) { illegal++; continue; }
  if (game.inCheckmate()) mates++;
}
assert.equal(illegal, 0, 'native engine must only return legal moves');
assert.equal(mates, set.puzzles.length, 'native C++ engine must find mate-in-one for every retained puzzle');
console.log(JSON.stringify({ test: 'Chelo native C++ mate-in-one retention', positions: set.puzzles.length, nodesPerPosition: 8000, foundMateInOne: mates, illegalMoves: illegal, result: 'PASS' }, null, 2));
