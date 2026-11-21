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
const Brain=root.CheloBrain,Save=root.CheloSave;
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const raw=fs.readFileSync(path.join(base,'models/dual-nnue-v38-256.bin'));
const model=root.CheloDualNNUE.parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
root.CheloDualNNUE.model=model;
const moveSequence=['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5c6','d7c6','a2a4','b7b5','a4b5'];
const packedMoves=Save.packMoves(moveSequence);assert.deepEqual(Array.from(Save.unpackMoves(packedMoves)),moveSequence,'Two-byte move codec must round-trip UCI history.');
assert.deepEqual(Array.from(Save.unpackMoves(Save.packMoves(['a7a8q','a7a8n','a7a8b','a7a8r']))),['a7a8q','a7a8n','a7a8b','a7a8r'],'Promotion move codes must survive packing.');
assert.equal(Save.unpackMoves('bad!'),null,'Corrupt packed move strings must be rejected.');
const player={id:'local-player',handle:'trainer_01',displayName:'Trainer',settings:{sound:false},activeMatch:{version:4,mode:'human',movesPacked:'',updatedAt:1}};
function makeBrain(plan,id){return new Brain(id,{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion,plan});}
function addSyntheticMemories(brain,count){
  for(let i=0;i<count;i++){
    // The fourth FEN field is varied to provide distinct deterministic test keys.
    const entry=brain.entry(`8/8/8/8/8/8/8/K6k w - ep${i}`,'e2e4');
    entry.score=(i%201)-100;entry.visits=3+(i%11);entry.outcomes=i%5;entry.last=Date.now()-((i%365)*86400000);entry.tactical=i%7===0?2:0;
  }
  brain.save();
}

// Fresh file: shared model tensors must not be embedded in the player export.
const fresh=makeBrain('free','fresh-free');
const freshDoc={plan:'free',player,pets:[{id:'pet-free',data:fresh.compactData()}]};
const freshExport=Save.encode(freshDoc);
assert(freshExport.bytes.byteLength<4096,`Fresh Free .chelo should stay tiny, got ${freshExport.bytes.byteLength} bytes.`);
assert(!JSON.stringify(freshDoc).includes('w1')&&!('n' in freshDoc.pets[0].data)&&!('la' in freshDoc.pets[0].data)&&!('r' in freshDoc.pets[0].data),'Shared V14/V37 weights and retired legacy replay payloads must not be serialized.');
const freshRoundTrip=Save.decode(freshExport.bytes,'free');
assert.equal(freshRoundTrip.pets[0].data.i[0],'Chelo');
assert.deepEqual(Array.from(freshRoundTrip.pets[0].data.i),Array.from(freshDoc.pets[0].data.i));

// Free: stress the whole 100 KiB file, including player metadata and match state.
const free=makeBrain('free','stress-free');
addSyntheticMemories(free,2400);
const freeDoc={plan:'free',player,pets:[{id:'pet-free',data:free.compactData()}]};
const freeExport=Save.encode(freeDoc);
assert(freeExport.bytes.byteLength<=100*1024,'Free .chelo exceeded the complete 100 KiB ceiling.');
assert(Buffer.byteLength(JSON.stringify(freeDoc.pets[0].data))<=97*1024,'Free pet payload exceeded its reserved 97 KiB budget.');
const freeRestored=makeBrain('free','free-restored');freeRestored.importCompactData(Save.decode(freeExport.bytes,'free').pets[0].data);
assert.equal(freeRestored.data.petName,free.data.petName);
assert(freeRestored.memoryCount()>0,'Free memories were lost during .chelo round trip.');

// Bond/Arena adapters must be the same tensors consumed by the C++ accumulator.
const fen='rnbqkbnr/p1ppp1pp/5p2/1p6/2P2P2/8/PP1PP1PP/RNBQKBNR b KQkq - 0 3';
const learner=makeBrain('free','bond-training');
learner.observePetMove(fen,'e7e5',{side:'b'},1);
const beforeBond=Array.from(learner.data.dualLora.bond.aW);
learner.reinforce('win');
assert(learner.data.dualLora.bond.steps>0,'Bond adapter did not receive outcome training.');
assert.notDeepEqual(Array.from(learner.data.dualLora.bond.aW),beforeBond,'Bond adapter weights did not change after confirmed feedback.');
assert.equal(learner.data.dualLora.arena.steps,0,'A trainer match must not contaminate Arena adapter learning.');
const beforeArena=Array.from(learner.data.dualLora.arena.aW);
learner.observePetMove(fen,'e7e5',{side:'b'},1);
assert.equal(learner.reinforce('win',null,{layer:'arena'}).reason,'arena-attestation-required','Unattested arena exhibitions must not train the Arena adapter.');
assert.equal(learner.data.dualLora.arena.steps,0,'Unattested arena games must leave Arena steps unchanged.');
assert.deepEqual(Array.from(learner.data.dualLora.arena.aW),beforeArena,'Unattested arena games must leave Arena weights unchanged.');
learner.trainDualAdapter(fen,0.5,'b','arena',1,false);
assert(learner.data.dualLora.arena.steps>0,'The Arena adapter training primitive remains available to verified ingestion.');
assert.notDeepEqual(Array.from(learner.data.dualLora.arena.aW),beforeArena,'Arena adapter weights did not change after explicit adapter training.');
const compactLearner=learner.compactData();
const importedLearner=makeBrain('free','adapter-restore');importedLearner.importCompactData(compactLearner);
for(const layer of ['bond','arena'])for(const tensor of ['aW','aB','b'])assert.deepEqual(Array.from(importedLearner.data.dualLora[layer][tensor]),Array.from(learner.data.dualLora[layer][tensor]),`${layer}.${tensor} quantised save/import parity`);

// Pro: five independent 500 KiB pet records live in one .chelo collection.
const proBrains=Array.from({length:5},(_,i)=>makeBrain('pro',`pro-pet-${i+1}`));
for(let i=0;i<proBrains.length;i++){proBrains[i].data.petName=`Chelo ${i+1}`;addSyntheticMemories(proBrains[i],12000);}
const proDoc={plan:'pro',player,pets:proBrains.map((brain,i)=>({id:`pet-${i+1}`,data:brain.compactData()}))};
const proExport=Save.encode(proDoc);
assert.equal(proExport.stats.petBytes.length,5);
assert(proExport.stats.petBytes.every(bytes=>bytes<=500*1024),'At least one Pro pet exceeded 500 KiB.');
assert(proExport.bytes.byteLength<=5*500*1024+8192,'Five-pet Pro .chelo exceeded the account container ceiling.');
const proRestored=Save.decode(proExport.bytes,'pro');
assert.equal(proRestored.pets.length,5);
assert.equal(proRestored.pets[4].data.i[0],'Chelo 5');

// Adaptive challenge starts welcoming, then scales search budgets after results.
const adaptive=makeBrain('free','adaptive-challenge');
assert.equal(adaptive.data.elo,100,'A fresh pet must start at the conservative uncalibrated challenge baseline.');
const starterProfile=adaptive.adaptiveSearchProfile();
assert(starterProfile.maxNodes>=400&&starterProfile.maxNodes<=700&&starterProfile.maxDepth===1,'A fresh hatchling must start with a much smaller search budget and depth.');
for(let i=0;i<4;i++)adaptive.updateAdaptiveChallenge('loss');
const growingProfile=adaptive.adaptiveSearchProfile();
assert(adaptive.data.elo>100,'Repeated player wins should gradually raise Chelo challenge.');
assert(growingProfile.maxNodes>starterProfile.maxNodes&&growingProfile.maxTimeMs>starterProfile.maxTimeMs,'Chelo should think longer as challenge rises.');
for(let i=0;i<3;i++)adaptive.updateAdaptiveChallenge('win');
assert(adaptive.data.elo<100+4*54,'Repeated Chelo wins should lower the challenge again.');
const ratingRoundTrip=makeBrain('free','rating-round-trip');ratingRoundTrip.importCompactData(adaptive.compactData());
assert.equal(ratingRoundTrip.data.elo,adaptive.data.elo,'Adaptive challenge estimate must survive .chelo export/import.');
assert.equal(ratingRoundTrip.data.trainerWinStreak,adaptive.data.trainerWinStreak,'Win streak must survive .chelo export/import.');

// Tampering, entitlement mismatch, and old embedded model payloads are rejected.
const tampered=Uint8Array.from(freshExport.bytes);tampered[tampered.length-4]^=1;
assert.throws(()=>Save.decode(tampered,'free'),/checksum|valid JSON/i);
assert.throws(()=>Save.decode(proExport.bytes,'free'),/plan does not match/i);
const padded=new Uint8Array(Save.constants.FREE_FILE_BYTES+1);padded.fill(32);assert.throws(()=>Save.decode(padded,'free'),/not a valid|bytes/i,'Raw file bytes, not only parsed JSON size, must be checked.');
const legacy={format:'CHELO',version:1,plan:'free',player,pets:[{id:'pet-free',data:{...freshDoc.pets[0].data,n:{old:true}}}]};
assert.throws(()=>Save.validate(legacy,'free'),/invalid|legacy|Unsupported/i);

const report={test:'Chelo M5 adaptive companion and unified player-save gates',modelBytes:model.byteLength,modelSha256:require('node:crypto').createHash('sha256').update(raw).digest('hex'),freshFreeBytes:freshExport.bytes.byteLength,free:{bytes:freeExport.bytes.byteLength,limit:102400,retainedPositions:free.memoryCount(),petBytes:freeExport.stats.petBytes[0]},pro:{bytes:proExport.bytes.byteLength,limit:5*500*1024+8192,perPetBytes:proExport.stats.petBytes,retainedPositionsPerPet:proBrains.map(brain=>brain.memoryCount())},bondSteps:learner.data.dualLora.bond.steps,arenaSteps:learner.data.dualLora.arena.steps,adapterRoundTrip:'PASS',tamperAndEntitlementGuards:'PASS'};
console.log(JSON.stringify(report,null,2));
