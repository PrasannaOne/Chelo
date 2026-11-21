const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const base=path.resolve(__dirname,'..');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,DataView,ArrayBuffer,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,atob,btoa};
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
const Chess=root.ChessCore,Brain=root.ChesslingBrain;
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const brain=new Brain('engine-hardening-test',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
function compareAccumulator(chess,acc){
  for(const side of ['w','b']){
    const full=brain.forward(brain.extractFeatures(chess,side));
    const inc=brain.forwardFromAccumulator(acc,side);
    assert(Math.abs(full.value-inc.value)<1e-5,`value mismatch ${side}: ${full.value} / ${inc.value}`);
    for(let i=0;i<48;i++){
      assert(Math.abs(full.hidden1[i]-inc.hidden1[i])<2e-6,`hidden1 mismatch ${side}:${i}`);
      assert(Math.abs(full.hidden[i]-inc.hidden[i])<2e-6,`hidden mismatch ${side}:${i}`);
    }
    for(let i=0;i<3;i++)assert(Math.abs(full.wdl[i]-inc.wdl[i])<1e-5,`WDL mismatch ${side}:${i}`);
    assert.strictEqual(JSON.stringify(Array.from(acc[side].features)),JSON.stringify(Array.from(brain.extractFeatures(chess,side))));
  }
}

// Search-only scalar evaluation must match the full value head while avoiding
// the policy-prior path and WDL object construction.
{
  const pos=new Chess(),a=brain.makeSearchAccumulator(pos);
  for(const side of ['w','b']){
    const full=brain.forwardFromAccumulator(a,side).value;
    const scalar=brain.forwardValueFromAccumulator(a,side);
    assert(Math.abs(full-scalar)<1e-6,`scalar value head mismatch ${side}: ${full} / ${scalar}`);
  }
}

// Standard Polyglot reference vector for the initial position.
const initial=new Chess();
const startHash=root.ChesslingPolyglotHash(initial);
assert.strictEqual(startHash.hi.toString(16).padStart(8,'0')+startHash.lo.toString(16).padStart(8,'0'),'463b96181691fc9c');

// TypedArray TT: 262,144 direct-mapped entries, full 64-bit verification,
// bound-aware probing and mate distance normalisation by current ply.
const TT=root.ChesslingTypedTranspositionTable,tt=new TT(1<<18);
assert.strictEqual(tt.keyHi.length,262144);
assert(tt.keyHi instanceof Uint32Array&&tt.keyLo instanceof Uint32Array);
assert(tt.depth instanceof Int8Array&&tt.flag instanceof Uint8Array&&tt.score instanceof Int16Array&&tt.bestMove instanceof Uint16Array);
tt.store(startHash,5,30000-10,1,'e2e4',2);
const mateProbe=tt.probe(startHash,5,-32000,32000,5);
assert(mateProbe.hit&&mateProbe.cutoff);
assert.strictEqual(mateProbe.score,30000-10-(5-2));
assert.strictEqual(mateProbe.move,'e2e4');
assert.strictEqual(tt.probe({hi:startHash.hi^1,lo:startHash.lo},1,-32000,32000,0).hit,false);
const alphaKey={hi:startHash.hi^0x100,lo:startHash.lo^1};tt.store(alphaKey,4,-120,2,'d2d4',0);
assert(tt.probe(alphaKey,4,0,100,0).cutoff,'ALPHA bound must cut off fail-low window');
const betaKey={hi:startHash.hi^0x200,lo:startHash.lo^2};tt.store(betaKey,4,120,3,'e2e4',0);
assert(tt.probe(betaKey,4,-100,0,0).cutoff,'BETA bound must cut off fail-high window');
tt.clear();assert.strictEqual(tt.probe(startHash,1,-32000,32000,0).hit,false);

// Full and incremental first-layer accumulators must match through ordinary
// play and the special move cases that touch extra squares.
let seed=0x5c4a11;
function rand(n){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;}
let chess=new Chess(),acc=brain.makeSearchAccumulator(chess),updated=0;
compareAccumulator(chess,acc);
for(let game=0;game<3;game++){
  for(let ply=0;ply<80;ply++){
    const legal=chess.moves({verbose:true,skipSan:true});if(!legal.length)break;
    const move=legal[rand(legal.length)],played=chess.move(move.uci,{skipSan:true});
    assert(played,'random legal move should apply');
    acc=brain.updateSearchAccumulator(acc,chess,played);updated++;
    compareAccumulator(chess,acc);
  }
  chess=new Chess();acc=brain.makeSearchAccumulator(chess);
}
const special=[
  ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1','e5d6','en-passant'],
  ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1','e1g1','castling'],
  ['4k3/P7/8/8/8/8/8/4K3 w - - 0 1','a7a8q','promotion']
];
for(const [fen,uci,label] of special){
  const pos=new Chess(fen),a=brain.makeSearchAccumulator(pos);assert(pos.moves().includes(uci),`${label} fixture must be legal`);
  const move=pos.move(uci,{skipSan:true});a && compareAccumulator(pos,brain.updateSearchAccumulator(a,pos,move));updated++;
}

// Exercise the exact in-place make/unmake path used by recursive search.
// The nested two-ply walk must restore every feature and Float32 pre-activation.
{
  const pos=new Chess(),a=brain.makeSearchAccumulator(pos);
  const snapshot=()=>({w:{features:a.w.features.slice(),pre:a.w.pre.slice()},b:{features:a.b.features.slice(),pre:a.b.pre.slice()}});
  const equalSnapshot=(x,y)=>{for(const side of ['w','b']){assert.deepStrictEqual(Array.from(x[side].features),Array.from(y[side].features));for(let i=0;i<48;i++)assert(Math.abs(x[side].pre[i]-y[side].pre[i])<2e-5,`unmake preactivation drift ${side}:${i}`);}};
  const original=snapshot();
  const m1=pos.moves({verbose:true,skipSan:true})[0],played1=pos.move(m1.uci,{skipSan:true}),u1=brain.applySearchAccumulator(a,pos,played1);
  const m2=pos.moves({verbose:true,skipSan:true})[0],played2=pos.move(m2.uci,{skipSan:true}),u2=brain.applySearchAccumulator(a,pos,played2);
  compareAccumulator(pos,a);
  pos.undo();brain.restoreSearchAccumulator(a,u2);
  pos.undo();brain.restoreSearchAccumulator(a,u1);
  equalSnapshot(original,snapshot());compareAccumulator(pos,a);
}
// In-place make/unmake also covers the board mutations that touch extra squares.
for(const [fen,uci,label] of special){
  const pos=new Chess(fen),a=brain.makeSearchAccumulator(pos),before={w:{features:a.w.features.slice(),pre:a.w.pre.slice()},b:{features:a.b.features.slice(),pre:a.b.pre.slice()}};
  const legal=pos.moves({verbose:true,skipSan:true}).find(m=>m.uci===uci);assert(legal,`${label} in-place fixture must be legal`);
  const made=pos.move(uci,{skipSan:true}),undo=brain.applySearchAccumulator(a,pos,made);compareAccumulator(pos,a);
  pos.undo();brain.restoreSearchAccumulator(a,undo);
  for(const side of ['w','b']){assert.deepStrictEqual(Array.from(a[side].features),Array.from(before[side].features));for(let i=0;i<48;i++)assert(Math.abs(a[side].pre[i]-before[side].pre[i])<2e-5,`${label} unmake mismatch ${side}:${i}`);}
}

// Validate all compact book records are sorted, unique by key, well-formed and
// point to legal moves in their corresponding generated FENs.
const book=fs.readFileSync(path.join(base,'models','polyglot-book.bin'));
assert.strictEqual(book.length,20480);
assert.strictEqual(book.length%16,0);
const manifest=JSON.parse(fs.readFileSync(path.join(base,'benchmarks','book-manifest.json'),'utf8'));
assert.strictEqual(manifest.entries,1280);
assert.strictEqual(manifest.records.length,1280);
const view=new DataView(book.buffer,book.byteOffset,book.byteLength);
let prevHi=-1,prevLo=-1;
for(let i=0;i<book.length/16;i++){
  const at=i*16,hi=view.getUint32(at,false),lo=view.getUint32(at+4,false);
  assert(hi>prevHi||(hi===prevHi&&lo>prevLo),'book keys must be strictly sorted and unique');
  prevHi=hi;prevLo=lo;
}
for(const entry of manifest.records){const pos=new Chess(entry.fen),h=root.ChesslingPolyglotHash(pos);assert.strictEqual(h.hi.toString(16).padStart(8,'0')+h.lo.toString(16).padStart(8,'0'),entry.key);assert(pos.moves().includes(entry.move),`illegal book move ${entry.move}`);const hit=brain.chooseMove(pos,{bookBinary:new Uint8Array(book.buffer,book.byteOffset,book.byteLength),timeMs:100});assert(hit.book,`book should hit manifest position ${entry.key}`);assert.strictEqual(hit.move,entry.move,`Polyglot encoded move must decode to ${entry.move}`);assert.strictEqual(hit.nodes,0);}
const bookHit=brain.chooseMove(new Chess(),{bookBinary:new Uint8Array(book.buffer,book.byteOffset,book.byteLength),timeMs:100});
assert.strictEqual(bookHit.book,true);assert(new Chess().moves().includes(bookHit.move));assert.strictEqual(bookHit.nodes,0);

// Search smoke: legal output, root state restoration and configured search
// features reported by the core. Book omitted so timed search is exercised.
const searchPos=new Chess(),rootFen=searchPos.fen();
const search=brain.chooseMove(searchPos,{timeMs:100,nodeLimit:20000,maxDepth:6,incremental:true});
assert(searchPos.moves().includes(search.move));assert.strictEqual(searchPos.fen(),rootFen);
assert.strictEqual(search.ttSize,262144);assert.strictEqual(search.nullMovePruning,true);assert.strictEqual(search.lmr,true);
console.log(JSON.stringify({polyglotStartKey:'463b96181691fc9c',ttEntries:tt.size,incrementalMoveUpdates:updated,maxAccumulatorError:'< 1e-5',bookBytes:book.length,bookEntries:manifest.entries,bookHit:bookHit.move,search:{move:search.move,depth:search.depth,nodes:search.nodes,nps:search.nps,ttHits:search.ttHits}},null,2));
