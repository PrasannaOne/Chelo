#!/usr/bin/env node
'use strict';

// Frozen-brain A/B benchmark. Both brains use identical source code, search
// settings, opening positions and hardware. This does not train either model.
// Usage:
// node benchmarks/duel.js <baseline-soul.json|-> <candidate-soul.json|-> [games] [time-ms] [node-limit] [max-plies]

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const context = { window: {}, TextEncoder, Date, Math, console };
vm.createContext(context);
for (const file of ['chess.js', 'brain.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const Chess = context.window.ChessCore;
const Brain = context.window.ChesslingBrain;
if (!Chess || !Brain) throw new Error('Could not load Chessling chess/brain modules.');

const args = process.argv.slice(2);
const baselinePath = args[0] || '-';
const candidatePath = args[1] || '-';
const games = Math.max(2, Math.floor(Number(args[2]) || 10));
const timeMs = Math.max(80, Math.floor(Number(args[3]) || 120));
const nodeLimit = Math.max(1000, Math.floor(Number(args[4]) || 8000));
const maxPlies = Math.max(20, Math.floor(Number(args[5]) || 140));

function loadBrain(name, file) {
  const brain = new Brain(name, { persist: false });
  if (file && file !== '-') {
    const full = path.resolve(process.cwd(), file);
    const soul = JSON.parse(fs.readFileSync(full, 'utf8'));
    brain.importSoul(soul);
  }
  return brain;
}

const baseline = loadBrain('benchmark_baseline', baselinePath);
const candidate = loadBrain('benchmark_candidate', candidatePath);

function opening(moves) {
  const chess = new Chess();
  for (const move of moves) {
    if (!chess.move(move)) throw new Error(`Benchmark opening contains illegal move: ${move}`);
  }
  return chess.fen();
}

const openings = [
  opening([]),
  opening(['e2e4', 'e7e5', 'g1f3', 'b8c6']),
  opening(['d2d4', 'd7d5', 'c2c4']),
  opening(['c2c4', 'e7e5', 'g2g3']),
  opening(['g1f3', 'd7d5', 'g2g3'])
];

const stats = {
  baseline: { wins: 0, losses: 0, draws: 0, points: 0, nodes: 0, decisions: 0, depth: 0 },
  candidate: { wins: 0, losses: 0, draws: 0, points: 0, nodes: 0, decisions: 0, depth: 0 },
  truncated: 0,
  games: []
};

for (let index = 0; index < games; index++) {
  const candidateColor = index % 2 === 0 ? 'b' : 'w';
  const chess = new Chess(openings[index % openings.length]);
  let plies = 0;
  while (!chess.game_over() && plies < maxPlies) {
    const side = chess.turn();
    const isCandidate = side === candidateColor;
    const brain = isCandidate ? candidate : baseline;
    const result = brain.chooseMove(chess, { timeMs, nodeLimit });
    if (!result || !result.move || !chess.move(result.move)) {
      throw new Error(`Illegal or missing move in game ${index + 1}, ply ${plies + 1}: ${result?.move || 'none'}`);
    }
    const sideStats = isCandidate ? stats.candidate : stats.baseline;
    sideStats.nodes += Number(result.nodes) || 0;
    sideStats.depth += Number(result.depth) || 0;
    sideStats.decisions++;
    plies++;
  }

  let winner = chess.game_over() ? chess.result() : 'draw';
  const truncated = !chess.game_over();
  if (truncated) stats.truncated++;
  const candidateWon = winner === candidateColor;
  const baselineWon = winner !== 'draw' && winner !== candidateColor;
  if (candidateWon) { stats.candidate.wins++; stats.baseline.losses++; stats.candidate.points++; }
  else if (baselineWon) { stats.baseline.wins++; stats.candidate.losses++; stats.baseline.points++; }
  else { stats.candidate.draws++; stats.baseline.draws++; stats.candidate.points += 0.5; stats.baseline.points += 0.5; }
  stats.games.push({ game: index + 1, opening: index % openings.length + 1, candidateColor, result: winner, plies, truncated });
}

const average = item => item.decisions ? (item.nodes / item.decisions).toFixed(0) : '0';
const depth = item => item.decisions ? (item.depth / item.decisions).toFixed(2) : '0.00';
console.log('Chessling frozen-brain A/B benchmark');
console.log(`Games: ${games} | time/move: ${timeMs} ms | node limit: ${nodeLimit} | max plies: ${maxPlies}`);
console.log(`Baseline: ${stats.baseline.wins} wins, ${stats.baseline.losses} losses, ${stats.baseline.draws} draws, ${stats.baseline.points.toFixed(1)}/${games}`);
console.log(`Candidate: ${stats.candidate.wins} wins, ${stats.candidate.losses} losses, ${stats.candidate.draws} draws, ${stats.candidate.points.toFixed(1)}/${games}`);
console.log(`Average search: baseline ${average(stats.baseline)} nodes / decision at depth ${depth(stats.baseline)}; candidate ${average(stats.candidate)} nodes / decision at depth ${depth(stats.candidate)}`);
console.log(`Games ending at the ply cap: ${stats.truncated}`);
console.log('Per-game results:');
for (const item of stats.games) console.log(`  #${item.game}: candidate ${item.candidateColor === 'w' ? 'White' : 'Black'}, opening ${item.opening}, ${item.result}, ${item.plies} plies${item.truncated ? ' (ply-cap draw)' : ''}`);
console.log('Interpretation: this is a small sample tool, not a strength claim. Increase games, rotate seeds/openings, preserve a held-out set, and report confidence intervals.');
