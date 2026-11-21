'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const raw=fs.readFileSync(path.join(base,'models/dual-nnue-v38-256.bin'));
const model=root.ChesslingDualNNUE.parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
root.ChesslingDualNNUE.model=model;
const brain=new root.ChesslingBrain('dual-nnue-test',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
const FastBoard=root.ChesslingFastBoard,Chess=root.ChessCore,Search=root.ChesslingFastSearch;
assert.equal(model.byteLength,394776);assert.equal(model.features,768);assert.equal(model.hidden,256);
assert(brain.data.dualLora.bond.aW instanceof Int8Array);assert(brain.data.dualLora.arena.aW instanceof Int8Array);
function same(a,b,label){assert.equal(a.length,b.length,label+' length');for(let i=0;i<a.length;i++)assert.equal(a[i],b[i],`${label}[${i}]`);}
function makeBoard(game){const b=new FastBoard(game,128,brain.data.model);b.initAccumulator(brain.data.model,brain.v14Adapter,true,model,brain.data.dualLora);return b;}
const initial=new Chess();const board=makeBoard(initial);assert(board.dualReady);assert(board.dualAccW instanceof Int16Array&&board.dualAccB instanceof Int16Array);assert.equal(board.dualAccW.length,32768);assert.equal(board.dualAccB.length,32768);
// Incremental dual feature/accumulator parity against full recomputation on each position.
let seed=0x36d1a7;function rand(n){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;}
const game=new Chess(),walk=makeBoard(game),made=[];
for(let ply=0;ply<90;ply++){
  const n=walk.generateLegal(ply,false);if(!n)break;const move=walk.moveLists[ply][rand(n)],uci=walk.uci(move);
  const core=game.move(uci,{skipSan:true});assert(core,`Core rejected incremental test move ${uci}`);
  walk.makeMoveWithAccumulator(ply,move);made.push({ply,uci});
  const fresh=makeBoard(game),base=(ply+1)*256;
  same(walk.dualAccW.subarray(base,base+256),fresh.dualAccW.subarray(0,256),`white accumulator after ${uci}`);
  same(walk.dualAccB.subarray(base,base+256),fresh.dualAccB.subarray(0,256),`black accumulator after ${uci}`);
  same(walk.dualFeaturesW,fresh.dualFeaturesW,`white features after ${uci}`);
  same(walk.dualFeaturesB,fresh.dualFeaturesB,`black features after ${uci}`);
  assert(walk.verifyKey());
}
for(let i=made.length-1;i>=0;i--){const item=made[i];walk.unmakeMove(item.ply);game.undo();const fresh=makeBoard(game),base=item.ply*256;same(walk.dualAccW.subarray(base,base+256),fresh.dualAccW.subarray(0,256),'white rollback');same(walk.dualAccB.subarray(base,base+256),fresh.dualAccB.subarray(0,256),'black rollback');same(walk.dualFeaturesW,fresh.dualFeaturesW,'white feature rollback');same(walk.dualFeaturesB,fresh.dualFeaturesB,'black feature rollback');}
// Special-move incremental handling: en-passant, castling and promotion.
const special=[
  ['rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3','e5d6'],
  ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','e1g1'],
  ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1','a7a8q']
];
for(const [fen,uci] of special){const g=new Chess(fen),b=makeBoard(g),n=b.generateLegal(0,false);let move=0;for(let i=0;i<n;i++)if(b.uci(b.moveLists[0][i])===uci)move=b.moveLists[0][i];assert(move,`missing special move ${uci}`);b.makeMoveWithAccumulator(0,move);g.move(uci,{skipSan:true});const fresh=makeBoard(g);same(b.dualAccW.subarray(256,512),fresh.dualAccW.subarray(0,256),`${uci} white`);same(b.dualAccB.subarray(256,512),fresh.dualAccB.subarray(0,256),`${uci} black`);b.unmakeMove(0);}
// Unified .chelo pet snapshot: both quantised adapters travel together; no independent .soul files.
brain.data.dualLora.bond.shift=4;brain.data.dualLora.bond.aW[0]=12;brain.data.dualLora.bond.aB[1]=-7;brain.data.dualLora.bond.b[0]=3;brain.data.dualLora.bond.steps=21;
brain.data.dualLora.arena.shift=4;brain.data.dualLora.arena.aW[0]=-5;brain.data.dualLora.arena.aW[1]=7;brain.data.dualLora.arena.aB[62]=9;brain.data.dualLora.arena.b[0]=4;brain.data.dualLora.arena.b[1]=2;brain.data.dualLora.arena.steps=8;
const adapterBoard=makeBoard(new Chess());assert.equal(adapterBoard.dualBiasW[0],1); // Bond rank-1 and Arena rank-2 deltas combine with fixed-point shifts.
const compactPet=brain.compactData();assert.equal(compactPet.v,16);assert(compactPet.dl.bond&&compactPet.dl.arena);assert(!('n' in compactPet)&&!('la' in compactPet)&&!('r' in compactPet));
const restored=new root.ChesslingBrain('chelo-v16-restore',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});restored.importCompactData(compactPet);
assert.equal(restored.data.dualLora.bond.aW[0],12);assert.equal(restored.data.dualLora.bond.aB[1],-7);assert.equal(restored.data.dualLora.arena.aW[0],-5);assert.equal(restored.data.dualLora.arena.aB[62],9);
const restoredBoard=makeBoard(new Chess());const noAdapterBoard=makeBoard(new Chess());noAdapterBoard.initDualAccumulator(model,null);assert.notDeepEqual(Array.from(restoredBoard.dualBiasW),Array.from(noAdapterBoard.dualBiasW),'Bond/Arena adapters must change hidden-unit bias deltas');
const restoredFull=new root.ChesslingBrain('chelo-full-restore',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});restoredFull.importCompactData(compactPet);assert.equal(restoredFull.data.dualLora.arena.b[1],2);
// Rated search is deterministic for the same dual model and personal adapters.
const p1=brain.chooseMove(new Chess(),{maxNodes:30000,deterministicNodes:true,bookBinary:null,usePolicy:false});
const p2=brain.chooseMove(new Chess(),{maxNodes:30000,deterministicNodes:true,bookBinary:null,usePolicy:false});
assert.equal(p1.move,p2.move);assert.equal(p1.score,p2.score);assert.equal(p1.nodes,30000);assert.equal(p2.nodes,30000);assert(p1.dualPerspectiveNnue&&p1.dualNnueEvaluations>0);
const out={format:'Chelo M4 unified compact adapter tests',binaryBytes:model.byteLength,binarySha256:require('node:crypto').createHash('sha256').update(raw).digest('hex'),architecture:'(768 -> 32) x 2 -> 64 SCReLU -> 1',incrementalRandomPlies:made.length,incrementalAndUnmakeParity:'passed',specialMoves:special.map(x=>x[1]),cheloPetV16Bytes:Buffer.byteLength(JSON.stringify(compactPet)),legacySoulFiles:'retired; migration-only import remains',ratedDeterminism:{move:p1.move,score:p1.score,nodes:p1.nodes,dualEvaluations:p1.dualNnueEvaluations},teacherSearchMetadata:{maxAccumulator:p1.dualNnueMaxAbsAccumulator}};
console.log(JSON.stringify(out,null,2));
