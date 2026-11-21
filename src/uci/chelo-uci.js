#!/usr/bin/env node
'use strict';

// Lightweight UCI adapter for the Chelo Stage 3.9 search. This is a Node-only
// development entry point; it does not participate in the browser/PWA bundle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const ROOT = path.resolve(__dirname, '../..');
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MODEL_SHA256 = 'e14650d8f4ff79eb0197ab06fa7f6f370d53cc019289fde6f103e367db257826';

function loadRuntime() {
  for (const file of [
    'src/engine/polyglot-random.js',
    'src/engine/chess.js',
    'src/engine/endgame-kpk.js',
    'src/engine/fast-search.js',
    'src/nnue/dual-nnue.js',
    'src/soul/brain.js'
  ]) require(path.join(ROOT, file));

  const checkpoint = JSON.parse(fs.readFileSync(path.join(ROOT, 'models/base-v14-float32.json'), 'utf8'));
  if (checkpoint.version !== 14 || !checkpoint.tensors || !checkpoint.baseVersion) {
    throw new Error('Frozen V14 pet base checkpoint is missing or invalid.');
  }
  const modelBytes = fs.readFileSync(path.join(ROOT, 'models/dual-nnue-v38-256.bin'));
  const digest = crypto.createHash('sha256').update(modelBytes).digest('hex');
  if (digest !== MODEL_SHA256) throw new Error(`Dual-NNUE SHA-256 mismatch: ${digest}`);
  const buffer = modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength);
  globalThis.CheloDualNNUE.model = globalThis.CheloDualNNUE.parse(buffer);
  const brain = new globalThis.CheloBrain('chelo-uci', {
    persist: false,
    policyLearning: false,
    v14Mode: true,
    baseModel: checkpoint.tensors,
    baseVersion: checkpoint.baseVersion
  });
  return { Chess: globalThis.ChessCore, Search: globalThis.CheloFastSearch, brain, model: globalThis.CheloDualNNUE.model };
}

let runtime;
let chess;
let searchOptions = { moveTimeMs: 500, maxDepth: 32, maxNodes: 10000000 };
let quitting = false;

function output(line) { process.stdout.write(`${line}\n`); }
function setPosition(tokens) {
  let at = 1;
  if (tokens[at] === 'startpos') { chess = new runtime.Chess(START_FEN); at++; }
  else if (tokens[at] === 'fen') {
    at++;
    const fenParts = [];
    while (at < tokens.length && tokens[at] !== 'moves') fenParts.push(tokens[at++]);
    if (fenParts.length !== 6) throw new Error('position fen requires six FEN fields');
    chess = new runtime.Chess(fenParts.join(' '));
  } else throw new Error('position must use startpos or fen');
  if (tokens[at] === 'moves') {
    at++;
    for (; at < tokens.length; at++) {
      if (!chess.move(tokens[at], { skipSan: true })) throw new Error(`illegal move in position command: ${tokens[at]}`);
    }
  }
}

function handleGo(tokens) {
  const args = Object.create(null);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] in { wtime:1, btime:1, winc:1, binc:1, movetime:1, depth:1, nodes:1, mate:1, movestogo:1 }) {
      args[tokens[i]] = Number(tokens[++i]);
    }
  }
  const side = chess.s.t === 'w' ? 'w' : 'b';
  let moveTimeMs = searchOptions.moveTimeMs;
  if (Number.isFinite(args.movetime)) moveTimeMs = Math.max(10, args.movetime);
  else {
    const remaining = args[`${side}time`];
    const increment = args[`${side}inc`] || 0;
    if (Number.isFinite(remaining)) moveTimeMs = Math.max(10, Math.min(5000, Math.floor(remaining / 30 + increment * 0.7)));
  }
  const result = runtime.Search.search(runtime.brain, chess, {
    maxTimeMs: moveTimeMs,
    maxDepth: Number.isFinite(args.depth) ? Math.max(1, Math.min(40, args.depth)) : searchOptions.maxDepth,
    maxNodes: Number.isFinite(args.nodes) ? Math.max(1, args.nodes) : searchOptions.maxNodes,
    dualNnueModel: runtime.model,
    dualNnueAdapters: runtime.brain.data.dualLora,
    usePolicy: false,
    aspiration: true
  });
  if (result.move) {
    const score = Number.isFinite(result.score) ? ` score cp ${Math.trunc(result.score)}` : '';
    output(`info depth ${result.depth || 0} nodes ${result.nodes || 0} time ${result.elapsed || 0} nps ${result.nps || 0}${score}`);
    output(`bestmove ${result.move}`);
  } else output('bestmove 0000');
}

function command(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const tokens = trimmed.split(/\s+/);
  try {
    switch (tokens[0]) {
      case 'uci':
        output('id name Chelo Stage 3.9');
        output('id author Chelo Project');
        output('option name MoveTime type spin default 500 min 10 max 10000');
        output('uciok');
        break;
      case 'isready': output('readyok'); break;
      case 'ucinewgame': chess = new runtime.Chess(START_FEN); break;
      case 'position': setPosition(tokens); break;
      case 'go': handleGo(tokens); break;
      case 'stop': break; // Search is synchronous; go returns bestmove before stop can be read.
      case 'setoption': {
        const nameAt = tokens.indexOf('name'), valueAt = tokens.indexOf('value');
        if (nameAt >= 0 && valueAt > nameAt && tokens[nameAt + 1].toLowerCase() === 'movetime') {
          searchOptions.moveTimeMs = Math.max(10, Math.min(10000, Number(tokens[valueAt + 1]) || 500));
        }
        break;
      }
      case 'quit': quitting = true; break;
      case 'ponderhit': break;
      default: break;
    }
  } catch (error) {
    output(`info string Chelo UCI error: ${String(error.message || error).replace(/[\r\n]/g, ' ')}`);
    if (tokens[0] === 'go') output('bestmove 0000');
  }
}

try {
  runtime = loadRuntime();
  chess = new runtime.Chess(START_FEN);
} catch (error) {
  process.stderr.write(`Chelo UCI startup failed: ${error.stack || error}\n`);
  process.exit(1);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => { command(line); if (quitting) input.close(); });
input.on('close', () => { process.exitCode = 0; });
