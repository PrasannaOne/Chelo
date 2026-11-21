#!/usr/bin/env node
'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}
const engine = path.resolve(ROOT, arg('engine', './bin/chelo-uci'));
const runs = Math.max(1, Math.min(9, Number(arg('runs', 3)) || 3));
const nodeBudget = Math.max(50000, Math.min(5000000, Number(arg('nodes', 500000)) || 500000));
if (!fs.existsSync(engine)) throw new Error(`Engine not found: ${engine}. Run bash build_termux.sh first.`);

const positions = [
  { name: 'Start position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: 'Kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1' },
  { name: 'Rook endgame', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1' },
  { name: 'Promotion tactics', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8' },
  { name: 'Middlegame', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10' }
];

function runUci(fen, nodes) {
  const input = `uci\nisready\nucinewgame\nposition fen ${fen}\ngo nodes ${nodes}\nquit\n`;
  const child = spawnSync(engine, [], { cwd: ROOT, input, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Engine exited ${child.status}: ${child.stderr}`);
  const info = child.stdout.split(/\r?\n/).filter(line => line.startsWith('info depth ')).at(-1);
  const best = child.stdout.split(/\r?\n/).find(line => line.startsWith('bestmove '));
  if (!info || !best) throw new Error(`Missing UCI search result:\n${child.stdout}\n${child.stderr}`);
  const field = (key) => {
    const m = info.match(new RegExp(`(?:^|\\s)${key}\\s+(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  return { depth: field('depth'), nodes: field('nodes') + field('qnodes'), timeMs: field('time'), nps: field('nps'), bestmove: best.split(/\s+/)[1] };
}

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

const startInput = `uci\nisready\nposition startpos\nperft 5\nquit\n`;
const perft = spawnSync(engine, [], { cwd: ROOT, input: startInput, encoding: 'utf8', timeout: 120000 });
if (perft.error || perft.status !== 0) throw perft.error || new Error(perft.stderr);
const perftMatch = perft.stdout.match(/nodes\s+(\d+)/);
if (!perftMatch || Number(perftMatch[1]) !== 4865609) throw new Error(`Start perft-5 failed: ${perft.stdout}`);

// One warm-up run reduces first-use effects. Measured results use fixed node budgets.
runUci(positions[0].fen, Math.min(nodeBudget, 150000));
const results = positions.map(position => {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(runUci(position.fen, nodeBudget));
  return {
    position: position.name,
    medianNps: median(samples.map(x => x.nps)),
    medianTimeMs: median(samples.map(x => x.timeMs)),
    deepestCompleted: Math.max(...samples.map(x => x.depth)),
    bestmoveSample: samples.at(-1).bestmove,
    samples
  };
});

const report = {
  benchmark: 'Chelo M8 native device benchmark',
  timestamp: new Date().toISOString(),
  device: {
    platform: os.platform(), arch: os.arch(), release: os.release(),
    cpu: os.cpus()[0]?.model || 'unknown', logicalCores: os.cpus().length,
    totalMemoryBytes: os.totalmem(), node: process.version
  },
  engine: path.relative(ROOT, engine), nodeBudget, runs,
  perft5: Number(perftMatch[1]), positions: results
};
console.log(JSON.stringify(report, null, 2));
