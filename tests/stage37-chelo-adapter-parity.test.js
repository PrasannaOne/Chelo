'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..');
function loadModel(modelDir,sourceDir=base,modelFile='dual-nnue-v37.bin'){
  const root={};const ctx={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};vm.createContext(ctx);
  for(const f of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(sourceDir,f),'utf8'),ctx,{filename:f});
  const cp=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(modelDir,modelFile));
  root.ChesslingDualNNUE.model=root.ChesslingDualNNUE.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const brain=new root.ChesslingBrain('stage37-chelo-adapter-parity',{persist:false,v14Mode:true,baseModel:cp.tensors,baseVersion:cp.baseVersion});
  return {root,brain,model:root.ChesslingDualNNUE.model,sha:crypto.createHash('sha256').update(bytes).digest('hex')};
}
const V37=loadModel(path.join(base,'models'),base,'dual-nnue-v37.bin'),V36=loadModel(path.join(base,'benchmarks','references','stage36','models'),base,'dual-nnue-v36-bootstrap.bin');
assert.equal(V37.model.byteLength,49368);assert.equal(V37.model.features,768);assert.equal(V37.model.hidden,32);
function seedAdapters(brain){
  const b=brain.data.dualLora.bond,a=brain.data.dualLora.arena;
  b.shift=4;b.steps=501;b.aW.fill(0);b.aB.fill(0);b.b.fill(0);
  b.aW[0]=11;b.aW[7]=-9;b.aB[1]=6;b.aB[31]=-4;b.b[0]=7;
  a.shift=5;a.steps=903;a.aW.fill(0);a.aB.fill(0);a.b.fill(0);
  a.aW[0]=-5;a.aW[1]=8;a.aW[31*2+1]=12;a.aB[12*2]=-7;a.aB[25*2+1]=9;a.b[0]=3;a.b[1]=-6;
}
function sameArray(a,b,label){assert.equal(a.length,b.length,`${label} length`);for(let i=0;i<a.length;i++)assert.equal(a[i],b[i],`${label}[${i}]`);}
seedAdapters(V36.brain);
const compact=V36.brain.compactData();
assert.equal(compact.v,16);assert(compact.dl.bond&&compact.dl.arena);assert(!('n' in compact)&&!('la' in compact)&&!('r' in compact));
V37.brain.importCompactData(compact);
for(const name of ['bond','arena'])for(const key of ['aW','aB','b'])sameArray(V36.brain.data.dualLora[name][key],V37.brain.data.dualLora[name][key],`${name}.${key}`);
assert.equal(V37.brain.data.dualLora.bond.shift,V36.brain.data.dualLora.bond.shift);
assert.equal(V37.brain.data.dualLora.arena.shift,V36.brain.data.dualLora.arena.shift);
// The old V15 .soul envelope remains a one-time migration path; no legacy envelope can be exported.
const legacyV15Pet={v:15,i:['Chelo','chelo_pet','Legacy Trainer',1,100,1000,0,0,0,0,0],t:[50,50,50],m:[],o:[],r:[],u:[],g:[0,0,0,0,0],y:['Unbenchmarked',0,null],c:1,vv:1,dl:compact.dl};
const legacyV15={format:'Chessling Soul',version:15,encoding:'legacy-migration-only',pet:legacyV15Pet};
const legacyV15Target=new V37.root.CheloBrain('chelo-legacy-v15',{persist:false,v14Mode:true,baseModel:JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8')).tensors,baseVersion:'v13-f32-policy-2026-11-19-seed-20261119'});
legacyV15Target.importSoul(legacyV15);
for(const name of ['bond','arena'])for(const key of ['aW','aB','b'])sameArray(V36.brain.data.dualLora[name][key],legacyV15Target.data.dualLora[name][key],`legacyV15 ${name}.${key}`);
assert.equal(V37.root.CheloBrain,V37.root.ChesslingBrain,'legacy runtime API alias remains for migration/engine bridge compatibility');
function makeBoard(engine,adapter){const b=new engine.root.ChesslingFastBoard(new engine.root.ChessCore());b.initAccumulator(engine.brain.data.model,engine.brain.v14Adapter,true,engine.model,adapter?engine.brain.data.dualLora:null);return b;}
const b36=makeBoard(V36,true),b36base=makeBoard(V36,false),b37=makeBoard(V37,true),b37base=makeBoard(V37,false);
const deltas=(board,base,name)=>Array.from(board[name],(v,i)=>v-base[name][i]);
sameArray(deltas(b36,b36base,'dualBiasW'),deltas(b37,b37base,'dualBiasW'),'white adapter bias delta');
sameArray(deltas(b36,b36base,'dualBiasB'),deltas(b37,b37base,'dualBiasB'),'black adapter bias delta');
const report={format:'Chelo M4 unified adapter cross-model parity',v36BinarySha256:V36.sha,v37BinarySha256:V37.sha,unifiedCheloPetBytes:Buffer.byteLength(JSON.stringify(compact)),compactImportExport:'bit-identical adapter tensor round-trip',legacyV15MigrationImport:'bit-identical; old envelope accepted only for migration',biasDeltas:'bit-identical rank-1/rank-2 white and black hidden-bias deltas across V36 and V37',claimScope:'Adapter payload and fixed-point bias-delta parity only; different NNUE model weights are expected to produce different final evaluations.'};
console.log(JSON.stringify(report,null,2));
