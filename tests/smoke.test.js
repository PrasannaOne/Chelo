const fs = require('fs');
const vm = require('vm');
const path = require('path');
const store = {};
const context = {
  window: {}, TextEncoder, Date, Math, console,
  localStorage: {
    getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: key => { delete store[key]; }
  }
};
vm.createContext(context);
for (const file of ['chess.js', 'brain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, {filename:file});
}
const Chess = context.window.ChessCore;
const Brain = context.window.ChesslingBrain;
function assert(condition, message) { if (!condition) throw new Error(message); }
function perft(chess, depth) {
  if (!depth) return 1;
  let count = 0;
  for (const move of chess.moves()) {
    chess.move(move, {skipSan:true});
    count += perft(chess, depth - 1);
    chess.undo();
  }
  return count;
}
function expectPerft(name, fen, expected) {
  const chess = new Chess(fen);
  for (let depth = 1; depth <= expected.length; depth++) {
    const actual = perft(chess, depth);
    assert(actual === expected[depth - 1], `${name} perft(${depth}) expected ${expected[depth - 1]} but got ${actual}`);
  }
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
expectPerft('Start position', START, [20, 400, 8902, 197281]);
expectPerft('Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]);
expectPerft('Position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]);
expectPerft('Position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]);
expectPerft('Position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]);
expectPerft('Position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]);

const opening = new Chess();
for (const move of ['e2e4','e7e5','g1f3','b8c6','f1b5']) assert(opening.move(move), `Could not play ${move}`);
assert(opening.pgn() === '1. e4 e5 2. Nf3 Nc6 3. Bb5', 'SAN / PGN notation failed');
assert(opening.historyMoves()[0].uci === 'e2e4', 'UCI storage notation failed');

const ep = new Chess();
for (const move of ['e2e4','a7a6','e4e5','d7d5']) assert(ep.move(move), `Could not play ${move}`);
assert(ep.moves().includes('e5d6'), 'En passant was not generated');
assert(ep.move('e5d6') && !ep.get('d5'), 'En passant did not remove the captured pawn');

const promo = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
assert(promo.moves().includes('a7a8q') && promo.moves().includes('a7a8n'), 'Promotion options missing');
assert(promo.move('a7a8q') && promo.get('a8').type === 'q', 'Promotion failed');

const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert(castle.moves().includes('e1g1') && castle.moves().includes('e1c1'), 'Castling moves missing');
assert(castle.move('e1g1') && castle.get('f1')?.type === 'r' && !castle.get('h1'), 'Kingside castling rook move failed');

const mate = new Chess();
for (const move of ['f2f3','e7e5','g2g4']) assert(mate.move(move), `Could not play ${move}`);
const queenMate = mate.move('d8h4');
assert(queenMate?.san === 'Qh4#' && mate.inCheckmate() && mate.result() === 'b', 'Checkmate / SAN detection failed');

const repetition = new Chess();
for (const move of ['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8']) assert(repetition.move(move), `Could not play ${move}`);
assert(repetition.inThreefold() && repetition.canClaimDraw(), 'Threefold draw claim failed');
assert(new Chess('8/8/8/8/8/8/4k3/4K3 w - - 100 51').canClaimDraw(), '50-move draw claim failed');
const seventyFive = new Chess('4k3/8/8/8/8/8/R7/4K3 w - - 150 76');
assert(seventyFive.game_over() && seventyFive.result() === 'draw', 'Automatic 75-move draw failed');
const fivefold = new Chess();
for (let cycle = 0; cycle < 4; cycle++) for (const move of ['g1f3','g8f6','f3g1','f6g8']) assert(fivefold.move(move), `Fivefold repetition move failed: ${move}`);
assert(fivefold.game_over() && fivefold.result() === 'draw', 'Automatic fivefold repetition draw failed');

const brain = new Brain('test_brain');
assert(brain.data.elo === 100, 'Chessling must start at 100');
assert(brain.data.model.w2.every(value => value === 0), 'A new neural value model should start with a neutral output layer');
assert(brain.data.elo === 100 && brain.data.model.steps === 0, 'A new pet should begin without learned model updates');
brain.observeHumanMove(START, 'e2e4', 1);
assert(brain.data.lastHumanMove.mirror === 'e7e5', 'Opening habit mirror failed');
const afterE4 = new Chess();
afterE4.move('e2e4');
const beforePetReply = afterE4.fen();
afterE4.move('e7e5');
brain.observePetMove(beforePetReply, 'e7e5', {piece:'p'}, 2, afterE4);
const previousScore = brain.data.memory[brain.simplifyFen(beforePetReply)]['e7e5'].score;
brain.reinforce('win', afterE4);
const learnedScore = brain.data.memory[brain.simplifyFen(beforePetReply)]['e7e5'].score;
assert(learnedScore > previousScore, 'Winning result did not reinforce the remembered move');
assert(brain.data.wins === 1 && brain.data.games === 1, 'Match record did not update');
assert(brain.data.model.steps > 0 && brain.data.model.w2.some(value => Math.abs(value) > 0), 'Neural model weights did not learn from game feedback');
assert(brain.data.model.episodes === 1 && brain.data.replay.length > 0, 'Completed game was not added to experience replay');

const soulText = brain.exportSoul({moves:['e2e4','e7e5']});
const soul = JSON.parse(soulText);
const restored = new Brain('restored_brain', {persist:false});
const activeMatch = restored.importSoul(soul);
assert(restored.data.elo === brain.data.elo && restored.data.wins === 1, 'Soul did not restore rating/record');
assert(restored.memoryCount() === brain.memoryCount(), 'Soul did not restore position memories');
assert(activeMatch.moves.length === 2, 'Soul did not restore active match');
assert(soul.encoding === 'compact-neural-json-v4' && soul.pet.v === 4, 'Soul export did not use the V4 neural compact encoding');
assert(restored.data.model.steps === brain.data.model.steps, 'Soul import did not restore the neural model');

const bounded = new Brain('bounded_brain', {persist:false});
for (let i = 0; i < 250; i++) {
  const fen = `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - ${i%250} 1`;
  bounded.data.memory[fen] = {e2e4:{score:i%80,visits:3,mirror:0,outcomes:1,last:i+1},d2d4:{score:4,visits:2,mirror:0,outcomes:1,last:i+2},g1f3:{score:-2,visits:1,mirror:0,outcomes:0,last:i+3},c2c4:{score:1,visits:1,mirror:0,outcomes:0,last:i+4}};
  bounded.data.humanOpenings[fen] = {e2e4:{count:2,last:i+1},d2d4:{count:1,last:i+2}};
  bounded.data.openingReplies[fen] = {e7e5:{count:1,score:0,last:i+1},d7d5:{count:1,score:0,last:i+2}};
}
bounded.save();
assert(bounded.size() <= context.window.CHESSLING_BRAIN_LIMIT, `Brain exceeded 50 KiB: ${bounded.size()} bytes`);
assert(bounded.memoryCount() <= 1000, 'Brain exceeded its preserved 1,000-position ceiling');
const compactStored = JSON.parse(JSON.stringify(bounded.compactData()));
const compactRestore = new Brain('compact_restore', {data:bounded.data,persist:false});
assert(compactRestore.size() === bounded.size(), 'Compact brain representation changed size during restore');
assert(compactRestore.memoryCount() === bounded.memoryCount(), 'Compact brain representation lost memories');
// Soul export must judge the compact brain payload, not the much larger expanded in-memory object.
assert(new TextEncoder().encode(JSON.stringify(bounded.data)).length > context.window.CHESSLING_BRAIN_LIMIT, 'Boundary fixture must exercise an expanded object larger than 50 KiB.');
const boundedSoul = JSON.parse(bounded.exportSoul());
assert(boundedSoul.pet.v === 4 && boundedSoul.encoding === 'compact-neural-json-v4', 'A brain within the 50 KiB compact limit could not be exported as a Soul.');

const tacticalBrain = new Brain('tactical_test', {persist:false});
const mateInOne = new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
const search = tacticalBrain.chooseMove(mateInOne, {timeMs:500,nodeLimit:50000});
assert(search.move === 'g6g7', `AI failed to choose mate in one (got ${search.move})`);

// The AI must return a legal move from a normal position at its 100-growth starting point.
const hatchling = new Brain('hatchling_test', {persist:false});
const openingPosition = new Chess();
const hatchlingMove = hatchling.chooseMove(openingPosition, {timeMs:300,nodeLimit:14000});
assert(openingPosition.moves().includes(hatchlingMove.move), '100-growth hatchling returned an illegal move');

// Layer 1: repeated player opening habits should measurably influence its reply.
const habitBrain = new Brain('habit_test', {persist:false});
const afterHumanE4 = new Chess();
habitBrain.observeHumanMove(afterHumanE4.fen(), 'e2e4', 1);
afterHumanE4.move('e2e4');
const mirroredReply = habitBrain.chooseMove(afterHumanE4, {timeMs:250,nodeLimit:12000});
assert(mirroredReply.mirrored && mirroredReply.move === 'e7e5', 'Habit mirroring did not reproduce the mirrored e-pawn opening');

// Layer 2: learned position/move values must be able to change move selection.
const memoryBrain = new Brain('memory_test', {persist:false});
memoryBrain.data.elo = 2400;
const memoryPosition = new Chess();
const memoryKey = memoryBrain.simplifyFen(memoryPosition.fen());
memoryBrain.data.memory[memoryKey] = {e2e4:{score:100,visits:20,mirror:0,outcomes:5,last:Date.now()}};
const memoryChoice = memoryBrain.chooseMove(memoryPosition, {timeMs:450,nodeLimit:30000});
assert(memoryChoice.move === 'e2e4', 'FEN trap memory did not influence a familiar position');

// Match outcomes preserve Gemini's original +15 / -20 / +2 reinforcement directions.
for (const [outcome, expected] of [['win',15],['loss',-20],['draw',2]]) {
  const feedbackBrain = new Brain('feedback_' + outcome, {persist:false});
  const position = new Chess();
  feedbackBrain.observePetMove(position.fen(), 'e7e5', {piece:'p'}, 2, position);
  const key = feedbackBrain.simplifyFen(position.fen());
  feedbackBrain.reinforce(outcome, position);
  assert(feedbackBrain.data.memory[key]['e7e5'].score === expected, `${outcome} feedback did not use the expected ${expected} signal`);
}

// Continuous learning: a pet decision remains pending until the human's reply resolves it.
const continuousBrain = new Brain('continuous_test', {persist:false});
const beforePetMove = new Chess();
beforePetMove.move('e2e4');
const petMoveFen = beforePetMove.fen();
beforePetMove.move('e7e5');
continuousBrain.observePetMove(petMoveFen, 'e7e5', {piece:'p'}, 2, beforePetMove);
assert(continuousBrain.data.pending.length === 1, 'Pet move was not observed immediately');
const beforeResponseScore = continuousBrain.data.memory[continuousBrain.simplifyFen(petMoveFen)]['e7e5'].score;
beforePetMove.move('d2d4');
continuousBrain.resolveLastPetMove(beforePetMove);
assert(continuousBrain.data.pending[0].r === 1, 'Human reply did not resolve the previous pet move');

// Self-play observations resolve for either colour and never change rating or W/L/D.
const practiceBrain = new Brain('practice_test', {persist:false});
const practiceStartElo = practiceBrain.data.elo;
const selfPlay = new Chess();
const whiteFen = selfPlay.fen();
const whiteMove = selfPlay.move('e2e4');
practiceBrain.observePetMove(whiteFen, whiteMove.uci, {piece:'p',side:'w'}, 1, selfPlay);
const blackFen = selfPlay.fen();
const blackMove = selfPlay.move('e7e5');
practiceBrain.resolveLastPetMove(selfPlay);
practiceBrain.observePetMove(blackFen, blackMove.uci, {piece:'p',side:'b'}, 2, selfPlay);
assert(practiceBrain.data.pending[0].side === 'w' && practiceBrain.data.pending[0].r === 1, 'White-side practice decision was not resolved');
practiceBrain.reinforce('practice', selfPlay);
assert(practiceBrain.data.practiceGames === 1, 'Practice session was not counted');
assert(practiceBrain.data.elo === practiceStartElo, 'Self-play practice incorrectly awarded Growth Elo');
assert(practiceBrain.data.wins === 0 && practiceBrain.data.losses === 0 && practiceBrain.data.draws === 0, 'Self-play practice changed the match record');

// A completed self-play result can teach the final move without awarding a pet match win or Elo.
const completedPracticeBrain = new Brain('completed_practice_test', {persist:false});
const scholarMate = new Chess();
for (const move of ['f2f3','e7e5','g2g4']) {
  const before = scholarMate.fen();
  const played = scholarMate.move(move);
  completedPracticeBrain.observePetMove(before, played.uci, {piece:played.piece,side:move[0]==='e'?'b':'w'}, scholarMate.historyMoves().length, scholarMate);
  completedPracticeBrain.resolveLastPetMove(scholarMate);
}
const finalFen = scholarMate.fen();
const finalMove = scholarMate.move('d8h4');
completedPracticeBrain.observePetMove(finalFen, finalMove.uci, {piece:'q',side:'b'}, scholarMate.historyMoves().length, scholarMate);
const finalKey = completedPracticeBrain.simplifyFen(finalFen);
completedPracticeBrain.reinforce('practice', scholarMate);
assert(completedPracticeBrain.data.memory[finalKey]['d8h4'].score === 15, 'Practice checkmate result did not reinforce the winning side final move.');
assert(completedPracticeBrain.data.model.steps > 0 && completedPracticeBrain.data.replay.length > 0, 'Practice match did not train and retain neural experiences.');
assert(completedPracticeBrain.data.elo === 100 && completedPracticeBrain.data.wins === 0, 'Practice result incorrectly awarded rating or match wins.');

// Every pet gets the same configured maximum search depth; Elo is not a strength switch.
const neutralBrain = new Brain('neutral_search', {persist:false});
assert(Object.keys(neutralBrain.data.policy).length === 0, 'A new pet should not start with learned legacy preferences');
assert(neutralBrain.predict(Array(context.window.CHESSLING_MODEL_INPUTS).fill(0)) === 0, 'A new pet neural model should start neutral');
assert(!/const maxDepth = this\.data\.elo/.test(fs.readFileSync(path.join(__dirname,'..','brain.js'),'utf8')), 'Search depth must not depend on displayed Elo');

// UI regression checks: the frame fixes a square footprint, its 8×8 tracks are equal,
// and the old duplicate abcdefgh label row is not in the page markup.
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(/\.board-frame\{[^}]*aspect-ratio:1 \/ 1/.test(css), 'Board frame must enforce a square aspect ratio');
assert(/\.chessboard\{position:absolute;inset:0;width:100%;height:100%/.test(css), 'Board must fill its square frame');
assert(/grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/.test(css) && /grid-template-rows:repeat\(8,minmax\(0,1fr\)\)/.test(css), 'Board must use eight equal columns and rows');
assert(!html.includes('abcdefgh'), 'Duplicate file-label row returned to the page markup');
assert(html.includes('Start practice') && html.includes('Skip to end') && html.includes('practiceStatus'), 'Live, visible self-play UI is missing');
assert(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8').includes('visibilitychange'), 'Practice must pause when the page is hidden');
const piecesSvg = fs.readFileSync(path.join(__dirname, '..', 'pieces.svg'), 'utf8');
for (const id of ['wp','wn','wb','wr','wq','wk','bp','bn','bb','br','bq','bk']) assert(piecesSvg.includes(`id="${id}"`), `Missing SVG chess piece ${id}`);
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
for (const asset of ['index.html','style.css','chess.js','brain.js','app.js','ai-worker.js','pieces.svg']) assert(sw.includes(`'./${asset}'`), `Service worker does not precache ${asset}`);

console.log('Chessling V4 neural-learning foundation tests passed.');
console.log('Perft verified: Start 20/400/8902/197281; Kiwipete 48/2039/97862; positions 3–6 verified.');
console.log(`50 KiB brain test: ${bounded.size()} bytes across ${bounded.memoryCount()} positions.`);
console.log(`AI tests: legal hatchling move, habit mirror (${mirroredReply.move}), trap-memory influence (${memoryChoice.move}), mate-in-one (${search.move}), neural updates (${brain.data.model.steps}).`);
console.log('UI/PWA checks: square 8×8 board contract, 12 vector pieces, and offline assets verified.');
