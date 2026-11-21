'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/chelo-save.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const bytes=fs.readFileSync(path.join(base,'models/dual-nnue-v37.bin'));
const model=root.CheloDualNNUE.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
root.CheloDualNNUE.model=model;
const Save=root.CheloSave,results=[];
const player={id:'test-player',handle:'test_trainer',settings:{},activeMatch:{version:4,mode:'human',movesPacked:'',updatedAt:1}};
for(const plan of ['free','pro']){
  const limit=plan==='free'?100*1024:500*1024;
  const brain=new root.CheloBrain(`chelo-size-${plan}`,{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion,plan});
  const fresh=Save.encode({plan,player,pets:[{id:'pet-1',data:brain.compactData()}]});
  assert(fresh.bytes.byteLength<2048,`${plan} fresh .chelo duplicated a shared model or legacy learner.`);
  for(let i=0;i<(plan==='free'?2500:14000);i++){
    const key=`8/8/8/8/8/8/8/K6k w - ep${i}`;
    const entry=brain.entry(key,'e2e4');entry.score=(i%201)-100;entry.visits=4+(i%13);entry.outcomes=i%5;entry.last=Date.now()-(i%365)*86400000;entry.tactical=i%11===0?3:0;
  }
  brain.save();
  const document={plan,player,pets:[{id:'pet-1',data:brain.compactData()}]};
  const exported=Save.encode(document),fileBytes=exported.bytes.byteLength,petBytes=exported.stats.petBytes[0];
  assert(fileBytes<=limit,`${plan} complete .chelo exceeded ${limit} bytes.`);
  if(plan==='free')assert(petBytes<=97*1024,'Free pet allocation must stay within 97 KiB to reserve player and container bytes.');
  else assert(petBytes<=500*1024,'Pro pet allocation must stay within 500 KiB.');
  const restored=new root.CheloBrain(`restore-${plan}`,{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion,plan});
  restored.importCompactData(Save.decode(exported.bytes,plan).pets[0].data);
  assert.equal(restored.data.dualLora.bond.steps,brain.data.dualLora.bond.steps);
  assert.equal(restored.data.dualLora.arena.steps,brain.data.dualLora.arena.steps);
  assert(restored.memoryCount()>0,'Compressed personal memories must survive import/export.');
  results.push({plan,fileBytes,wholeFileLimitBytes:limit,petBytes,retainedPositionFingerprints:brain.memoryCount(),freshFileBytes:fresh.bytes.byteLength,adapters:'quantised Int8 rank-1 Bond + rank-2 Arena; round-trip PASS'});
}
const proBrains=Array.from({length:5},(_,index)=>new root.CheloBrain(`five-${index}`,{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion,plan:'pro'}));
const five=Save.encode({plan:'pro',player,pets:proBrains.map((brain,index)=>({id:`pet-${index+1}`,data:brain.compactData()}))});
assert.equal(Save.decode(five.bytes,'pro').pets.length,5);
assert(five.bytes.byteLength<=5*500*1024+8192,'Five-pet Pro container exceeded its combined 2.5 MiB allowance.');
const report={test:'M5 exact .chelo byte-budget audit',format:'CHELO v1 / pet V16',sharedV37Bytes:model.byteLength,sharedV37Sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),results,proFivePetContainerBytes:five.bytes.byteLength,proFivePetLimitBytes:5*500*1024+8192};
console.log(JSON.stringify(report,null,2));
