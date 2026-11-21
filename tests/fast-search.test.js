const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const base=path.resolve(__dirname,'..');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,atob,btoa,performance};
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
const Chess=root.ChessCore,FastBoard=root.ChesslingFastBoard,Brain=root.ChesslingBrain;
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const brain=new Brain('fast-search-test',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
function fastPerft(board,depth,ply=0){if(!depth)return 1;const n=board.generateLegal(ply,false),list=board.moveLists[ply];let total=0;for(let i=0;i<n;i++){board.makeMoveWithAccumulator(ply,list[i]);total+=fastPerft(board,depth-1,ply+1);board.unmakeMove(ply);}return total;}
function corePerft(chess,depth){if(!depth)return 1;const moves=chess.moves();let total=0;for(const m of moves){chess.move(m,{skipSan:true});total+=corePerft(chess,depth-1);chess.undo();}return total;}
const fixtures=[
  ['start','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',[20,400,8902]],
  ['kiwipete','r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',[48,2039,97862]],
  ['position-3','8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',[14,191,2812]],
  ['position-4','r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',[6,264,9467]],
  ['position-5','rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',[44,1486,62379]],
  ['position-6','r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',[46,2079,89890]],
  ['en-passant','rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',[31,null]],
  ['castling','r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',[26,null]],
  ['promotion','4k3/P7/8/8/8/8/8/4K3 w - - 0 1',[9,null]]
];
for(const [label,fen,expected] of fixtures){
  const chess=new Chess(fen),fast=new FastBoard(chess);fast.initAccumulator(brain.data.model);
  for(let d=1;d<=expected.length;d++){
    const reference=corePerft(chess,d),actual=fastPerft(fast,d);
    if(expected[d-1]!==null)assert.strictEqual(reference,expected[d-1],`${label} ChessCore perft(${d}) baseline`);
    assert.strictEqual(actual,reference,`${label} FastBoard perft(${d}) mismatch`);
    assert.strictEqual(fast.fen(),fen,`${label} make/unmake did not restore FEN`);
    assert(fast.verifyKey(),`${label} Zobrist key failed after perft`);
  }
}
// Randomised make/unmake fuzz across ordinary and special moves.
let seed=0x7451a2f3;function rand(n){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;}
const game=new Chess(),fast=new FastBoard(game);fast.initAccumulator(brain.data.model);
for(let ply=0;ply<180;ply++){
  const n=fast.generateLegal(0,false);if(!n)break;const move=fast.moveLists[0][rand(n)],uci=fast.uci(move),beforeFen=fast.fen(),beforeHi=fast.hashHi,beforeLo=fast.hashLo;
  const coreMove=game.move(uci,{skipSan:true});assert(coreMove,`FastBoard generated illegal move ${uci}`);
  fast.makeMoveWithAccumulator(0,move);assert.strictEqual(fast.fen(),game.fen(),`board mismatch after ${uci}`);assert(fast.verifyKey(),`incremental hash mismatch after ${uci}`);
  const expected=brain.makeSearchAccumulator(game);assert.deepStrictEqual(Array.from(fast.accFeaturesW),Array.from(expected.w.features));assert.deepStrictEqual(Array.from(fast.accFeaturesB),Array.from(expected.b.features));
  fast.unmakeMove(0);game.undo();assert.strictEqual(fast.fen(),beforeFen);assert.strictEqual(fast.hashHi,beforeHi);assert.strictEqual(fast.hashLo,beforeLo);assert(fast.verifyKey());
  // Commit both paths, so later plies exercise realistic repetition/game history.
  game.move(uci,{skipSan:true});fast.makeMoveWithAccumulator(0,move);
  if(game.game_over()){break;}
}
// Allocation-free SEE: an undefended pawn capture is +100 and a queen
// capture immediately lost to a rook is -800. SEE must restore all board bytes.
function findPacked(board,uci){const n=board.generateLegal(0,false);for(let i=0;i<n;i++)if(board.uci(board.moveLists[0][i])===uci)return board.moveLists[0][i];return 0;}
const seeGoodFen='4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',seeGood=new FastBoard(new Chess(seeGoodFen));
const seeGoodMove=findPacked(seeGood,'e4d5');assert(seeGoodMove,'SEE positive fixture move missing');
assert.strictEqual(seeGood.see(seeGoodMove),100,'SEE positive capture value mismatch');assert.strictEqual(seeGood.fen(),seeGoodFen);assert(seeGood.verifyKey());
const seeBadFen='4k3/8/8/3p4/4Q3/8/K7/3r4 w - - 0 1',seeBad=new FastBoard(new Chess(seeBadFen));
const seeBadMove=findPacked(seeBad,'e4d5');assert(seeBadMove,'SEE negative fixture move missing');
assert.strictEqual(seeBad.see(seeBadMove),-800,'SEE losing queen capture mismatch');assert.strictEqual(seeBad.fen(),seeBadFen);assert(seeBad.verifyKey());
const seeEpFen='4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',seeEp=new FastBoard(new Chess(seeEpFen));
const seeEpMove=findPacked(seeEp,'e5d6');assert(seeEpMove,'SEE en-passant fixture move missing');assert.strictEqual(seeEp.see(seeEpMove),100,'SEE en-passant victim was not counted');assert.strictEqual(seeEp.fen(),seeEpFen);
const seePromoFen='4k3/P7/8/8/8/8/8/4K3 w - - 0 1',seePromo=new FastBoard(new Chess(seePromoFen));
const seePromoMove=findPacked(seePromo,'a7a8q');assert(seePromoMove,'SEE promotion fixture move missing');assert.strictEqual(seePromo.see(seePromoMove),800,'SEE promotion gain mismatch');assert.strictEqual(seePromo.fen(),seePromoFen);
// At equal shallow depth, PVS/aspiration must preserve the full-window root result.
const pvsOn=brain.chooseMove(new Chess(),{maxNodes:12000,maxTimeMs:10000,maxDepth:2,usePolicy:false,pvs:true,aspirationWindow:1});
const pvsOff=brain.chooseMove(new Chess(),{maxNodes:12000,maxTimeMs:10000,maxDepth:2,usePolicy:false,pvs:false,aspiration:false});
assert.strictEqual(pvsOn.depth,2);assert.strictEqual(pvsOff.depth,2);assert.strictEqual(pvsOn.move,pvsOff.move,'PVS changed the shallow best move');assert.strictEqual(pvsOn.score,pvsOff.score,'PVS changed the shallow root score');
const pawnOnly=new FastBoard(new Chess('4k3/pp6/8/8/8/8/PP6/4K3 w - - 0 1'));assert.strictEqual(pawnOnly.hasNonPawnMaterial(),false,'pawn-only side must be excluded from null-move pruning');
// The 24 KiB bitbase is a genuine one-bit-per-state KPK WDL table.
assert(root.CHESSLING_KPK_WDL instanceof Uint8Array);assert.strictEqual(root.CHESSLING_KPK_WDL.length,24576);
assert.deepStrictEqual(Buffer.from(root.CHESSLING_KPK_WDL),fs.readFileSync(path.join(base,'models','kpk-wdl.bin')),'embedded KPK table differs from raw bitbase asset');
const kpkWin=new FastBoard(new Chess('2k5/P7/2K5/8/8/8/8/8 w - - 0 1'));
const kpkDraw=new FastBoard(new Chess('8/8/8/8/8/2k5/P7/2K5 w - - 0 1'));
assert.strictEqual(root.ChesslingFastSearch.probeKpkWdl(kpkWin),1200,'KPK winning fixture was not recognized');
assert.strictEqual(root.ChesslingFastSearch.probeKpkWdl(kpkDraw),0,'KPK drawn fixture was not recognized');
const kqk=new FastBoard(new Chess('7k/8/8/8/8/8/8/6QK w - - 0 1'));
const krk=new FastBoard(new Chess('7k/8/8/8/8/8/8/6RK w - - 0 1'));
const kbnk=new FastBoard(new Chess('7k/8/8/8/8/8/8/5NBK w - - 0 1'));
assert.strictEqual(root.ChesslingFastSearch.probeBareKingWin(kqk),1600,'KQK material theorem not recognised');
assert.strictEqual(root.ChesslingFastSearch.probeBareKingWin(krk),1600,'KRK material theorem not recognised');
assert.strictEqual(root.ChesslingFastSearch.probeBareKingWin(kbnk),1600,'KBNK material theorem not recognised');
const kbbSame=new FastBoard(new Chess('7k/8/8/8/8/8/8/3B1BK1 w - - 0 1'));
assert.strictEqual(root.ChesslingFastSearch.probeBareKingWin(kbbSame),2147483646,'same-colour KBBK must be treated as a draw');
const kbbOpposite=new FastBoard(new Chess('7k/8/8/8/8/8/8/5BBK w - - 0 1'));
assert.strictEqual(root.ChesslingFastSearch.probeBareKingWin(kbbOpposite),0,'opposite-colour KBBK must remain position-sensitive');
const integerBoard=new FastBoard(new Chess());integerBoard.initAccumulator(brain.data.model,brain.v14Adapter,brain.v14Mode);
// The WDL head's final ratio uses a restoring integer divider (no `/` in search).
let divideSeed=0x3381cafe;for(let i=0;i<20000;i++){divideSeed=(Math.imul(divideSeed,1664525)+1013904223)|0;const numerator=(((divideSeed>>>0)%65534001)-32767000)|0;divideSeed=(Math.imul(divideSeed,1664525)+1013904223)|0;const denominator=1+((divideSeed>>>0)%98301);assert.strictEqual(root.ChesslingFastSearch.divScalar31(numerator,denominator),(numerator/denominator)|0,'fixed-point integer divider differs from truncating division');}
const integerScore=root.ChesslingFastSearch.scalarValue(brain,integerBoard,0);
assert.strictEqual(integerScore,integerScore|0,'scalar value head must return a signed 32-bit integer');
assert(integerScore>=-1000&&integerScore<=1000,'quantised WDL value outside expected range');
assert(integerBoard.accPreW instanceof Int32Array&&integerBoard.accPreB instanceof Int32Array,'incremental accumulator must be integer typed arrays');
// Current game history is loaded into the paired-word repetition table.
const repetition=new Chess();for(let i=0;i<2;i++)for(const m of ['g1f3','g8f6','f3g1','f6g8'])repetition.move(m,{skipSan:true});
const repFast=new FastBoard(repetition);assert(repFast.rep.get(repFast.hashHi0,repFast.hashHi1,repFast.hashLo0,repFast.hashLo1)>=3,'historical threefold count was not seeded');
// Search uses the new FastBoard path and respects deterministic node ceilings.
const searchPos=new Chess(),search=brain.chooseMove(searchPos,{maxNodes:1500,maxTimeMs:10000,maxDepth:6,usePolicy:false});
const repeatSearch=brain.chooseMove(new Chess(),{maxNodes:1500,maxTimeMs:10000,maxDepth:6,usePolicy:false});
assert(searchPos.moves().includes(search.move),`Fast search returned illegal move ${search.move}`);
assert(search.fastBoard&&search.packedMoves&&search.repetitionTable&&search.zeroAllocationSourceHotPath&&search.runtimeAllocationVerified===false&&search.hashVerified&&search.lazyNnueAccumulator);assert(search.maxLazyAccumulatorPending<=2,'lazy accumulator exceeded two pending plies');
assert.strictEqual(search.nodes,1500,`maxNodes should be deterministic: ${search.nodes}`);assert.strictEqual(search.score,search.score|0,'negamax score must remain a signed integer');
assert.strictEqual(repeatSearch.nodes,search.nodes);assert.strictEqual(repeatSearch.move,search.move);assert.strictEqual(repeatSearch.depth,search.depth);
console.log(JSON.stringify({fastBoardPerft:'passed',fixtures:fixtures.map(x=>x[0]),randomizedMakeUnmakePlies:180,see:{positive:seeGood.see(seeGoodMove),negative:seeBad.see(seeBadMove)},pvsEquivalence:{move:pvsOn.move,score:pvsOn.score,depth:pvsOn.depth,aspirationResearches:pvsOn.aspirationResearches},repetitionCount:repFast.rep.get(repFast.hashHi0,repFast.hashHi1,repFast.hashLo0,repFast.hashLo1),search:{move:search.move,depth:search.depth,nodes:search.nodes,nps:search.nps,hashVerified:search.hashVerified,maxNodes:search.maxNodes,maxLazyAccumulatorPending:search.maxLazyAccumulatorPending}},null,2));
