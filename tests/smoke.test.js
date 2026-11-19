const fs = require('fs');
const vm = require('vm');
const path = require('path');
const store = {};
const context = {
  window: {}, TextEncoder, Date, Math, console,
  localStorage: { getItem: key => store[key] || null, setItem: (key, value) => { store[key] = value; } }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'chess.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'brain.js'), 'utf8'), context);
const Chess = context.window.ChessCore;
const Brain = context.window.ChesslingBrain;
function assert(condition, message) { if (!condition) throw new Error(message); }
function perft(chess, depth) { if (!depth) return 1; let count=0; for (const move of chess.moves()) { chess.move(move); count += perft(chess, depth-1); chess.undo(); } return count; }

const start = new Chess();
assert(perft(start,1)===20 && perft(start,2)===400 && perft(start,3)===8902, 'Starting-position perft failed');
const tricky = new Chess('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
assert(perft(tricky,1)===6 && perft(tricky,2)===264 && perft(tricky,3)===9467, 'Special-position perft failed');
const ep = new Chess();
for (const m of ['e2e4','a7a6','e4e5','d7d5']) assert(ep.move(m), `Could not play ${m}`);
assert(ep.moves().includes('e5d6'), 'En passant was not generated');
assert(ep.move('e5d6') && !ep.get('d5'), 'En passant did not remove the captured pawn');
const promo = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
assert(promo.moves().includes('a7a8q') && promo.moves().includes('a7a8n'), 'Promotion options missing');
assert(promo.move('a7a8q') && promo.get('a8').type==='q', 'Promotion failed');
const mate = new Chess();
for (const m of ['f2f3','e7e5','g2g4','d8h4']) assert(mate.move(m), `Could not play ${m}`);
assert(mate.inCheckmate() && mate.result()==='b', 'Checkmate detection failed');
const brain = new Brain();
assert(brain.data.elo===100, 'Chessling must start at 100');
for(let i=0;i<2000;i++) brain.observeHumanMove(`position-${i} w - - 0 1`, 'e2e4', 1);
assert(brain.size()<=context.window.CHESSLING_BRAIN_LIMIT, 'Brain exceeded the 50 KiB cap');
const soul=JSON.parse(brain.exportSoul());
const restored=new Brain('restored');restored.importSoul(soul);
assert(restored.data.elo===100 && restored.memoryCount()===brain.memoryCount(), 'Soul import/export failed');
console.log('Chessling smoke tests passed.');
console.log(`Start-position perft: 20 / 400 / 8902. Brain: ${brain.size()} bytes, ${brain.memoryCount()} remembered positions.`);
