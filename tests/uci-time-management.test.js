'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'bin/chelo-uci');
function search(command) {
  const started = Date.now();
  const r = spawnSync(binary, [], { cwd: root, input: `uci\nisready\nposition startpos\n${command}\nquit\n`, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split(/\r?\n/).find(x => x.startsWith('info depth '));
  assert.ok(line, r.stdout);
  assert.match(r.stdout, /bestmove [a-h][1-8][a-h][1-8][nbrq]?/);
  const field = name => Number(line.match(new RegExp(`\\b${name}\\s+(\\d+)`))?.[1] || 0);
  return { wall: Date.now() - started, searchMs: field('time'), depth: field('depth'), nodes: field('nodes') + field('qnodes') };
}
const moveTime = search('go movetime 160');
assert(moveTime.depth >= 1 && moveTime.nodes > 0);
assert(moveTime.searchMs <= 260, `movetime 160 ms exceeded expected hard limit: ${moveTime.searchMs} ms`);
const clock = search('go wtime 2000 btime 2000 winc 100 binc 100 movestogo 24');
assert(clock.depth >= 1 && clock.nodes > 0);
assert(clock.searchMs <= 400, `clock allocation did not respect its hard budget: ${clock.searchMs} ms`);
const nodes = search('go nodes 30000');
assert.equal(nodes.nodes, 30000, 'node-limited UCI search must count main + qnodes exactly');
console.log(JSON.stringify({ test: 'UCI time management', movetime: moveTime, clock: clock, fixedNodes: nodes, result: 'PASS' }, null, 2));
