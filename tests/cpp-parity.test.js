'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const rootDir=path.resolve(__dirname,'..');
const binary=path.join(rootDir,'bin/chelo-uci');
assert(fs.existsSync(binary),'Run build_termux.sh before this test.');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(rootDir,file),'utf8'),context,{filename:file});
const checkpoint=JSON.parse(fs.readFileSync(path.join(rootDir,'models/base-v14-float32.json'),'utf8'));
const raw=fs.readFileSync(path.join(rootDir,'models/dual-nnue-v38-256.bin'));
const model=root.CheloDualNNUE.parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
root.CheloDualNNUE.model=model;
const brain=new root.CheloBrain('cpp-parity',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
// Non-zero, representative rank-1 Bond and rank-2 Arena adapters.
Object.assign(brain.data.dualLora.bond,{shift:4,steps:21});
brain.data.dualLora.bond.aW[0]=12;brain.data.dualLora.bond.aB[1]=-7;brain.data.dualLora.bond.b[0]=3;
Object.assign(brain.data.dualLora.arena,{shift:4,steps:8});
brain.data.dualLora.arena.aW[0]=-5;brain.data.dualLora.arena.aW[1]=7;brain.data.dualLora.arena.aB[62]=9;brain.data.dualLora.arena.b[0]=4;brain.data.dualLora.arena.b[1]=2;
function encodeAdapter(a,rank){const b=Buffer.alloc(4+513*rank);b[0]=rank;b[1]=a.shift;b.writeUInt16LE(a.steps&65535,2);let p=4;for(const x of a.aW)b.writeInt8(x,p++);for(const x of a.aB)b.writeInt8(x,p++);for(const x of a.b)b.writeInt8(x,p++);return b;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'chelo-cpp-'));
const bond=path.join(tmp,'bond.bin'),arena=path.join(tmp,'arena.bin');fs.writeFileSync(bond,encodeAdapter(brain.data.dualLora.bond,1));fs.writeFileSync(arena,encodeAdapter(brain.data.dualLora.arena,2));
const fens=[
 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQK2R b KQkq - 0 5',
 '8/8/8/3k4/8/4K3/4P3/8 w - - 0 1',
 '7k/8/8/8/8/8/6Q1/6K1 w - - 0 1',
 '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
 'r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1'
];
function mop(b){let ownK=-1,enemyK=-1,own=0,enemy=0;for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=b.b[sq];if(!p)continue;const t=((p-1)%6)+1,v=t===5?900:t===4?500:t===3?330:t===2?320:t===1?100:0;if(t===6){if((p<=6?0:1)===b.side)ownK=sq;else enemyK=sq;}else if((p<=6?0:1)===b.side)own+=v;else enemy+=v;}if(ownK<0||enemyK<0||own<=enemy+250)return 0;const f=enemyK&7,r=enemyK>>4,edge=Math.min(f,7-f,r,7-r),dx=Math.abs((ownK&7)-f),dy=Math.abs((ownK>>4)-r),inward=Math.max(0,12-dx-dy);return (7-edge)*7+inward*2;}
function expected(fen){const game=new root.ChessCore(fen),board=new root.CheloFastBoard(game,128,brain.data.model);board.initAccumulator(brain.data.model,brain.v14Adapter,true,model,brain.data.dualLora);const k=root.CheloFastSearch.probeKpkWdl(board),bare=root.CheloFastSearch.probeBareKingWin(board);return k!==2147483647?k:bare===2147483646?0:bare?bare+mop(board):root.CheloFastSearch.scalarValue(brain,board,0)+mop(board);}
const lines=['uci','setoption name Bond_LoRA value '+bond,'setoption name Arena_LoRA value '+arena,'verifyincremental 64','hashcheck','verifyspecial','verifysee 160','verifyattack 160'];const want=[];
const seeWant=[];for(const fen of fens){lines.push('position fen '+fen,'eval');want.push(expected(fen));const game=new root.ChessCore(fen),board=new root.CheloFastBoard(game,128,brain.data.model);board.initAccumulator(brain.data.model,brain.v14Adapter,true,model,brain.data.dualLora);const count=board.generateLegal(0,false),list=board.moveLists[0];for(let i=0;i<count;i++){const move=list[i],captured=(move>>>16)&15,promo=(move>>>20)&7,flags=(move>>>24)&15;if(captured||promo||(flags&1)){const uci=board.uci(move),score=board.see(move);lines.push('position fen '+fen,'see '+uci);seeWant.push({uci,score});}}}
lines.push('ucinewgame','position startpos moves e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3','go nodes 30000','ucinewgame','position startpos moves e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3','go nodes 30000','quit');const run=spawnSync(binary,[],{cwd:rootDir,input:lines.join('\n')+'\n',encoding:'utf8'});assert.equal(run.status,0,run.stderr);const got=[...run.stdout.matchAll(/info string eval cp (-?\d+)/g)].map(x=>Number(x[1]));assert.deepEqual(got,want,'C++ V37+LoRA static evaluations must match Stage 3.10 exactly');const seeGot=[...run.stdout.matchAll(/info string see ([a-h][1-8][a-h][1-8][nbrq]?) (-?\d+)/g)].map(x=>({uci:x[1],score:Number(x[2])}));assert.deepEqual(seeGot,seeWant,'C++ static exchange evaluation must match Stage 3.10 for the tested legal capture/promotion corpus');assert.match(run.stdout,/info string incremental PASS/,'incremental NNUE must match full recomputation under both non-zero adapters');assert.match(run.stdout,/info string zobrist PASS/,'incremental Zobrist hash must match recomputation');assert.match(run.stdout,/info string special transitions PASS/,'castle/en-passant/promotion accumulator and hash updates must match full recomputation');assert.match(run.stdout,/info string see parity PASS/,'optimized bitboard SEE must match the slow reference on deterministic legal playouts');assert.match(run.stdout,/info string attack parity PASS/,'bitboard leaper/ray attacks must match the mailbox reference on deterministic legal playouts');
const fixed=[...run.stdout.matchAll(/info depth (\d+) nodes (\d+) qnodes (\d+) score cp (-?\d+)[\s\S]*?bestmove ([a-h][1-8][a-h][1-8][nbrq]?)/g)];assert.equal(fixed.length,2,'two deterministic fixed-node searches expected');const fixedRuns=fixed.map(x=>({depth:Number(x[1]),nodes:Number(x[2]),qnodes:Number(x[3]),score:Number(x[4]),bestmove:x[5]}));assert.equal(fixedRuns[0].nodes+fixedRuns[0].qnodes,30000,'first fixed-node budget must be exact');assert.deepEqual(fixedRuns[1],fixedRuns[0],'fixed-node search must be reproducible from the same position/configuration');
const mate=spawnSync(binary,[],{cwd:rootDir,input:['ucinewgame','position fen 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1','go depth 4','quit',''].join('\n'),encoding:'utf8'});assert.equal(mate.status,0,mate.stderr);assert.match(mate.stdout,/info depth 1 nodes \d+ qnodes 0 score cp 28999[\s\S]*?bestmove f7e8/,'root mate preflight must immediately retain a mate score and find Qe8#');
const draws=spawnSync(binary,[],{cwd:rootDir,input:['ucinewgame','position startpos moves g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8','go depth 1','position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 100 1','go depth 1','position fen 7k/5Q2/6K1/8/8/8/8/8 w - - 100 1','go depth 4','quit',''].join('\n'),encoding:'utf8'});assert.equal(draws.status,0,draws.stderr);const drawScores=[...draws.stdout.matchAll(/info depth \d+ nodes \d+ qnodes \d+ score cp (-?\d+)/g)].map(x=>Number(x[1]));assert.deepEqual(drawScores,[0,0,0],'threefold repetition, rule-50 and root-mate-preflight positions at the draw threshold must be returned as draws');
console.log(JSON.stringify({test:'C++/Stage 3.10 static evaluation + incremental accumulator/hash parity',positions:fens.length,values:got,seePositions:seeGot.length,seeParity:'exact',randomSeePlayouts:160,randomAttackPlayouts:160,fixedNodeBudget:30000,fixedNodeSearch:'repeatable',repetitionAndRule50:'PASS',mateInOne:'PASS',bondAdapterBytes:fs.statSync(bond).size,arenaAdapterBytes:fs.statSync(arena).size,result:'PASS'},null,2));
fs.rmSync(tmp,{recursive:true,force:true});
