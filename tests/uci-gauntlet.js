#!/usr/bin/env node
'use strict';

// 60-game paired UCI match: every opening is played once with Chelo as White
// and once with Chelo as Black. No third-party Node packages are required.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const ROOT = path.resolve(__dirname, '..');
function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
}
function engineSpec(value) {
  if (!value) throw new Error('Engine path is required.');
  const filename = path.resolve(ROOT, value);
  if (!fs.existsSync(filename)) throw new Error(`Engine not found: ${filename}`);
  const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(filename);
  return { path: filename, command: isNodeScript ? process.execPath : filename,
    args: isNodeScript ? [filename] : [] };
}
const CHELO_SPEC = engineSpec(option('chelo', './bin/chelo-uci'));
const OPPONENT_SPEC = engineSpec(option('opponent', '../tomitankChess/tomitankChessUCI.js'));
const OPENINGS = [
  { name: 'Italian Game', moves: 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5' },
  { name: 'Sicilian', moves: 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3' },
  { name: 'Queen’s Gambit', moves: 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 g1f3 f8e7' },
  { name: 'King’s Indian', moves: 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6' },
  { name: 'English Opening', moves: 'c2c4 e7e5 b1c3 g8f6 g2g3 d7d5 c4d5 f6d5' },
  { name: 'Réti', moves: 'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7' },
  { name: 'French Defence', moves: 'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 e4e5 f6d7' },
  { name: 'Caro-Kann', moves: 'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5' },
  { name: 'Nimzo-Indian', moves: 'd2d4 d7d5 g1f3 g8f6 c2c4 e7e6 b1c3 f8b4' },
  { name: 'Scotch Four Knights', moves: 'e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4' }
];

const GAMES = Math.max(2, Math.floor(Number(option('games', 60)) / 2) * 2);
const MOVE_TIME = Math.max(10, Math.min(10000, Number(option('movetime', 500)) || 500));
const MAX_PLIES = Math.max(40, Math.min(600, Number(option('max-plies', 240)) || 240));
const OPPONENT_ELO = option('opponent-elo', null);
if (OPPONENT_ELO !== null && (!/^\d+$/.test(OPPONENT_ELO) || Number(OPPONENT_ELO) < 1320 || Number(OPPONENT_ELO) > 3190)) {
  throw new Error('--opponent-elo must be an integer from 1320 to 3190 for standard Stockfish builds.');
}
const TIMEOUT_MS = Math.max(5000, MOVE_TIME * 8 + 5000);
const OPENING_OFFSET = Math.max(0, Math.floor(Number(option('opening-offset', 0)) || 0));
const TRACE = process.env.CHELO_UCI_TRACE === '1';
function trace(message) { if (TRACE) process.stderr.write(`[uci-trace] ${message}\n`); }

class UciClient {
  constructor(label, spec) {
    this.label = label;
    this.spec = spec;
    this.child = null;
    this.lines = [];
    this.waiters = [];
    this.stderr = '';
    this.recentOutput = [];
    this.advertisedOptions = new Set();
    this.closed = false;
  }
  start() {
    if (!fs.existsSync(this.spec.path)) throw new Error(`${this.label} executable not found: ${this.spec.path}`);
    this.child = spawn(this.spec.command, this.spec.args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    out.on('line', line => this.onLine(line.trim()));
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      const error = new Error(`${this.label} exited (${signal || code}). ${this.stderr}`);
      for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
    });
    return this;
  }
  onLine(line) {
    this.recentOutput.push(line);
    if (this.recentOutput.length > 40) this.recentOutput.shift();
    const optionMatch = line.match(/^option name (.+?) type /i);
    if (optionMatch) this.advertisedOptions.add(optionMatch[1]);
    const index = this.waiters.findIndex(waiter => waiter.test(line));
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(line);
    } else {
      this.lines.push(line);
      if (this.lines.length > 500) this.lines.shift();
    }
  }
  send(line) {
    if (!this.child || this.closed) throw new Error(`${this.label} is not running`);
    this.child.stdin.write(`${line}\n`);
  }
  waitFor(test, timeout = TIMEOUT_MS) {
    const predicate = typeof test === 'function' ? test : line => test.test(line);
    const old = this.lines.findIndex(predicate);
    if (old >= 0) return Promise.resolve(this.lines.splice(old, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { test: predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        const recent = this.recentOutput.length ? `\nRecent stdout:\n${this.recentOutput.join('\n')}` : '';
        const stderr = this.stderr ? `\nRecent stderr:\n${this.stderr}` : '';
        reject(new Error(`${this.label} timed out waiting for UCI response after ${timeout} ms.${recent}${stderr}`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }
  async initialise(options = []) {
    this.send('uci'); await this.waitFor(/^uciok$/);
    const configured = options.slice();
    // A benchmark must compare equal search budgets. Disable each engine's
    // optional protocol overhead when it exposes the standard option.
    if (this.advertisedOptions.has('Move Overhead') && !configured.some(([name]) => name === 'Move Overhead')) {
      configured.unshift(['Move Overhead', '0']);
    }
    for (const [name, value] of configured) {
      if (!this.advertisedOptions.has(name)) throw new Error(`${this.label} does not advertise required UCI option: ${name}`);
      this.send(`setoption name ${name} value ${value}`);
    }
    this.send('isready'); await this.waitFor(/^readyok$/);
    this.send('ucinewgame');
  }
  async bestMove(position, moveTime) {
    const answer = this.waitFor(/^bestmove\s+/);
    this.send(`position startpos${position.length ? ` moves ${position.join(' ')}` : ''}`);
    this.send(`go movetime ${moveTime}`);
    const line = await answer;
    return line.split(/\s+/)[1] || '0000';
  }
  async close() {
    if (!this.child || this.closed) return;
    try { this.send('quit'); } catch {}
    await Promise.race([new Promise(resolve => this.child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 500))]);
    if (!this.closed) this.child.kill('SIGKILL');
  }
}

function loadChess() {
  require(path.join(ROOT, 'src/engine/chess.js'));
  return globalThis.ChessCore;
}

async function playGame(C, opening, cheloWhite, gameNumber) {
  const chelo = new UciClient('Chelo', CHELO_SPEC).start();
  const rival = new UciClient('Opponent', OPPONENT_SPEC).start();
  try {
    const opponentOptions = OPPONENT_ELO === null ? [] : [
      ['UCI_LimitStrength', 'true'],
      ['UCI_Elo', OPPONENT_ELO]
    ];
    await Promise.all([chelo.initialise(), rival.initialise(opponentOptions)]);
    const game = new C();
    const moves = opening.moves ? opening.moves.split(/\s+/) : [];
    for (const move of moves) {
      if (!game.move(move, { skipSan: true })) throw new Error(`Invalid gauntlet opening ${opening.name}: ${move}`);
    }
    const played = moves.slice();
    let plies = 0;
    trace(`game ${gameNumber} start ${opening.name} ${cheloWhite ? 'Chelo-White' : 'Chelo-Black'} FEN=${game.fen()}`);
    while (!game.game_over() && plies < MAX_PLIES) {
      const isWhite = game.s.t === 'w';
      const isCheloTurn = isWhite === cheloWhite;
      const engine = isCheloTurn ? chelo : rival;
      let move;
      try {
        move = await engine.bestMove(played, MOVE_TIME);
      } catch (error) {
        const context = [
          `Game: ${gameNumber} | Opening: ${opening.name} | Ply: ${plies}`,
          `Side to move: ${game.s.t} | Chelo is ${cheloWhite ? 'White' : 'Black'}`,
          `FEN: ${game.fen()}`,
          `Moves: ${played.join(' ') || '(none)'}`
        ].join('\n');
        throw new Error(`${error.message}\nPosition context:\n${context}`);
      }
      if (move === '0000' || !game.move(move, { skipSan: true })) {
        const winner = isCheloTurn ? 'rival' : 'chelo';
        return { result: winner === 'chelo' ? 'win' : 'loss', plies, reason: `${engine.label} returned illegal/no move` };
      }
      played.push(move);
      plies++;
      trace(`game ${gameNumber} ply ${plies - 1} accepted ${move}`);
    }
    if (game.game_over()) {
      const result = game.result();
      if (result === 'draw') return { result: 'draw', plies, reason: 'terminal draw' };
      const cheloWon = (result === 'w') === cheloWhite;
      return { result: cheloWon ? 'win' : 'loss', plies, reason: 'checkmate' };
    }
    return { result: 'draw', plies, reason: 'ply limit' };
  } finally {
    await Promise.all([chelo.close(), rival.close()]);
  }
}

function eloDifference(score, games) {
  const p = score / games;
  if (p <= 0) return '-Infinity';
  if (p >= 1) return '+Infinity';
  const value = 400 * Math.log10(p / (1 - p));
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

async function main() {
  if (!fs.existsSync(OPPONENT_SPEC.path)) {
    throw new Error(`Opponent UCI engine not found: ${OPPONENT_SPEC.path}. Pass --opponent /path/to/engine.`);
  }
  const Chess = loadChess();
  const pairs = GAMES / 2;
  let wins = 0, losses = 0, draws = 0;
  console.log(`Chelo UCI Gauntlet | ${GAMES} games (${pairs} colour-swapped pairs)`);
  console.log(`Chelo: ${path.relative(ROOT, CHELO_SPEC.path)} | Opponent: ${path.relative(ROOT, OPPONENT_SPEC.path)}${OPPONENT_ELO === null ? '' : ` (UCI_Elo ${OPPONENT_ELO})`} | Move time: ${MOVE_TIME} ms | Max plies: ${MAX_PLIES}`);
  for (let pair = 0; pair < pairs; pair++) {
    const opening = OPENINGS[(pair + OPENING_OFFSET) % OPENINGS.length];
    const first = await playGame(Chess, opening, true, pair * 2 + 1);
    const second = await playGame(Chess, opening, false, pair * 2 + 2);
    for (const game of [first, second]) {
      if (game.result === 'win') wins++;
      else if (game.result === 'loss') losses++;
      else draws++;
    }
    const completed = wins + losses + draws;
    const score = wins + draws / 2;
    console.log(`Pair ${String(pair + 1).padStart(2, '0')}/${pairs} | ${opening.name} | ${first.result}/${second.result} | W ${wins} L ${losses} D ${draws} (${completed}/${GAMES})`);
  }
  const score = wins + draws / 2;
  console.log('\n=== FINAL RESULTS ===');
  console.log(`Wins: ${wins} | Losses: ${losses} | Draws: ${draws}`);
  console.log(`Score: ${score.toFixed(1)}/${GAMES} (${(100 * score / GAMES).toFixed(1)}%)`);
  const p = score / GAMES;
  const elo = p <= 0 || p >= 1 ? null : 400 * Math.log10(p / (1 - p));
  const se = elo === null ? null : (400 / Math.LN10) / Math.sqrt(GAMES * p * (1 - p));
  console.log(`Estimated Elo difference (Chelo vs opponent): ${eloDifference(score, GAMES)} Elo`);
  if (se !== null) console.log(`Approx. 95% range: ${(elo - 1.96 * se).toFixed(1)} to ${(elo + 1.96 * se).toFixed(1)} Elo (sampling error only)`);
}

main().catch(error => { console.error(`UCI gauntlet failed: ${error.stack || error}`); process.exitCode = 1; });
