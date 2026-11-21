'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const engine = path.join(root, 'bin/chelo-uci');
const cases = [
  { name: 'Start position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 5, nodes: 4865609 },
  { name: 'Kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depth: 3, nodes: 97862 },
  { name: 'Position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', depth: 4, nodes: 43238 },
  { name: 'Position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', depth: 3, nodes: 9467 },
  { name: 'Position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', depth: 3, nodes: 62379 },
  { name: 'Position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', depth: 3, nodes: 89890 }
];
for (const t of cases) {
  const input = `position fen ${t.fen}\nperft ${t.depth}\nquit\n`;
  const result = spawnSync(engine, [], { cwd: root, input, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${t.name}: ${result.stderr}`);
  const m = result.stdout.match(/nodes\s+(\d+)/);
  assert.ok(m, `${t.name}: no perft result: ${result.stdout}`);
  assert.equal(Number(m[1]), t.nodes, `${t.name} perft ${t.depth}`);
  console.log(`${t.name}: perft(${t.depth}) ${t.nodes} PASS`);
}
