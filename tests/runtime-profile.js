'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Worker,isMainThread,workerData}=require('node:worker_threads');
const base=path.resolve(__dirname,'..');
function profile(id){
  const root={};
  const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
  vm.createContext(context);
  for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
  const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(base,'models/dual-nnue-v37.bin'));
  root.CheloDualNNUE.model=root.CheloDualNNUE.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const brain=new root.CheloBrain(`chelo-profile-${id}`,{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
  for(let i=0;i<12;i++)brain.chooseMove(new root.ChessCore(),{maxNodes:30000,deterministicNodes:true,bookBinary:null,usePolicy:false});
  console.log(`CHELO_PROFILE_BEGIN_${id}`);
  const result=brain.chooseMove(new root.ChessCore(),{maxNodes:30000,deterministicNodes:true,bookBinary:null,usePolicy:false});
  console.log(`CHELO_PROFILE_END_${id} ${JSON.stringify({move:result.move,score:result.score,depth:result.depth,nodes:result.nodes,nps:result.nps,dualEvaluations:result.dualNnueEvaluations,hashVerified:result.hashVerified})}`);
}
if(isMainThread){
  (async()=>{
    profile(0);
    for(let id=1;id<=4;id++)await new Promise((resolve,reject)=>{
      const worker=new Worker(__filename,{workerData:{id}});
      worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(new Error(`profile worker ${id} exited ${code}`)));
    });
    console.log('CHELO_PROFILE_ALL_ISOLATES_DONE');
  })().catch(error=>{console.error(error);process.exitCode=1;});
}else profile(workerData.id);
