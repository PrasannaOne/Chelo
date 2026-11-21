'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'bin/chelo-uci');

const noEp = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
const noCapturerEp = '4k3/8/8/8/8/8/8/4K3 w - d6 0 1';
const legalEp = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
const legalEpWithoutTarget = '4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1';
const pinnedEp = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
const pinnedEpWithoutTarget = 'k3r3/8/8/3pP3/8/8/8/4K3 w - - 0 1';

const draws = [
  ['bare kings', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 1],
  ['king and knight versus king', '4k3/8/8/8/8/8/8/4KN2 w - - 0 1', 1],
  ['king and bishop versus king', '4k3/8/8/8/8/8/8/4KB2 w - - 0 1', 1],
  ['bishops on same colour', '4k3/8/8/8/8/8/1b6/2B1K3 w - - 0 1', 1],
  ['opposite-colour bishops', '4k3/8/8/8/8/8/4b3/B3K3 w - - 0 1', 0],
  ['knight each', '4k3/8/8/8/8/8/4n3/4K1N1 w - - 0 1', 0],
  ['rook versus king', '4k3/8/8/8/8/8/8/4KR2 w - - 0 1', 0]
];

const input = [
  `position fen ${noEp}`, 'hash',
  `position fen ${noCapturerEp}`, 'hash',
  `position fen ${legalEp}`, 'hash',
  `position fen ${legalEpWithoutTarget}`, 'hash',
  `position fen ${pinnedEp}`, 'hash',
  `position fen ${pinnedEpWithoutTarget}`, 'hash',
  ...draws.flatMap(([, fen]) => [`position fen ${fen}`, 'drawcheck']),
  'quit', ''
].join('\n');
const run = spawnSync(bin, [], { cwd: root, input, encoding: 'utf8', timeout: 30000 });
assert.equal(run.status, 0, run.stderr || run.stdout);
const hashes = [...run.stdout.matchAll(/info string hash (\d+)/g)].map(m => BigInt(m[1]));
assert.equal(hashes.length, 6, 'six hash observations expected');
assert.equal(hashes[0], hashes[1], 'an unusable FEN en-passant target must not change position identity');
assert.notEqual(hashes[2], hashes[3], 'a legal en-passant capture must change position identity');
assert.equal(hashes[4], hashes[5], 'an en-passant capture exposing the king must not change position identity');
const drawResults = [...run.stdout.matchAll(/info string insufficient_material ([01])/g)].map(m => Number(m[1]));
assert.deepEqual(drawResults, draws.map(x => x[2]), 'insufficient-material classifications must match the JS baseline');

// Root best-move selection must not depend on a transposition-table store.
// Rule-50-near and repetition-sensitive roots intentionally suppress TT scores.
const rootSearch = spawnSync(bin, [], {
  cwd: root,
  input: [
    'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 90 1',
    'go depth 5',
    'position startpos moves g1f3 g8f6 f3g1 f6g8',
    'go depth 5',
    'quit', ''
  ].join('\n'),
  encoding: 'utf8',
  timeout: 30000
});
assert.equal(rootSearch.status, 0, rootSearch.stderr || rootSearch.stdout);
const rootMoves = [...rootSearch.stdout.matchAll(/bestmove ([a-h][1-8][a-h][1-8][nbrq]?)/g)].map(m => m[1]);
assert.deepEqual(rootMoves, ['e2e4', 'e2e4'], 'path-sensitive roots must return the searched best move, not the first generated move');
console.log(JSON.stringify({
  test: 'native position-identity and insufficient-material rules',
  enPassantHash: {
    noCapturerIgnored: hashes[0] === hashes[1],
    legalCaptureIncluded: hashes[2] !== hashes[3],
    illegalPinnedCaptureIgnored: hashes[4] === hashes[5]
  },
  insufficientMaterial: draws.map((x, i) => ({ position: x[0], draw: drawResults[i] === 1 })),
  pathSensitiveRootBestMove: { cases: rootMoves.length, moves: rootMoves, result: 'PASS' },
  result: 'PASS'
}, null, 2));
