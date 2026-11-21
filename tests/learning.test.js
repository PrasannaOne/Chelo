'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
vm.createContext(context);
const base=path.resolve(__dirname,'..');
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/chelo-save.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
const Chess=root.ChessCore,Brain=root.CheloBrain,Save=root.CheloSave;
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const raw=fs.readFileSync(path.join(base,'models/dual-nnue-v38-256.bin'));
const model=root.CheloDualNNUE.parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));root.CheloDualNNUE.model=model;
const make=(plan='free')=>new Brain('learning',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion,plan});

const brain=make(),sharedModelBefore=brain.data.model.w1.slice();
assert.equal(brain.limit,97*1024,'Free pet data must reserve space inside the full 100 KiB player file.');
assert.equal(typeof brain.exportSoul,'undefined','The old .soul exporter must be removed.');
assert.equal(brain.data.elo,100,'New Chelo pets begin at the conservative uncalibrated challenge baseline.');
const oldUnplayed=make();oldUnplayed.data.elo=300;oldUnplayed.data.ratingGames=0;const migratedUnplayed=make();migratedUnplayed.importCompactData(oldUnplayed.compactData());assert.equal(migratedUnplayed.data.elo,100,'Unplayed pets from the previous arbitrary 300 baseline must migrate to the gentler hatchling profile.');
const starter=brain.adaptiveSearchProfile();
const profileSweep=[];for(const rating of [100,300,600,900,1200,1500,1800,2100,2400]){brain.data.elo=rating;profileSweep.push(brain.adaptiveSearchProfile());}
for(let i=1;i<profileSweep.length;i++){assert(profileSweep[i].maxNodes>=profileSweep[i-1].maxNodes,'Adaptive node budget must be monotonic across its full rating range.');assert(profileSweep[i].maxTimeMs>=profileSweep[i-1].maxTimeMs,'Adaptive time budget must be monotonic across its full rating range.');assert(profileSweep[i].maxDepth>=profileSweep[i-1].maxDepth,'Adaptive depth must be monotonic across its full rating range.');}
brain.data.elo=100;
for(let i=0;i<8;i++)brain.updateAdaptiveChallenge('loss');
const advanced=brain.adaptiveSearchProfile();
assert(advanced.maxNodes>starter.maxNodes&&advanced.maxTimeMs>starter.maxTimeMs,'Challenge must scale up after repeated player wins.');
const advancedRating=brain.data.elo;brain.updateAdaptiveChallenge('win');
assert(brain.data.elo<advancedRating,'Challenge should ease back after Chelo wins.');

assert.equal(model.byteLength,394776,'The shared V37 model must remain frozen.');

// Confirmed trainer games update Bond only, using the same Int8 adapter tensors the C++ engine reads.
const position='rnbqkbnr/p1ppp1pp/5p2/1p6/2P2P2/8/PP1PP1PP/RNBQKBNR b KQkq - 0 3';
const tacticalPairs=brain.tacticalMovePairs(position,'b');
assert(tacticalPairs.positive.length>0&&tacticalPairs.negative.length>0,'Training fixture must contain positive and negative legal alternatives from the same position.');
const selectedPositive=tacticalPairs.positive[0],selectedNegative=tacticalPairs.negative[0];
const petScore=fen=>{const state=brain.dualNnueState(fen);return state?(state.side===1?state.score:-state.score):0;};
const marginBefore=petScore(selectedPositive.after)-petScore(selectedNegative.after);
const teachingMove=new Chess(position).moves({verbose:true,skipSan:true})[0];
brain.observePetMove(position,teachingMove.uci,{side:'b'},1);
const bondBefore=Array.from(brain.data.dualLora.bond.aW);
const bondReport=brain.reinforce('win');
const marginAfter=petScore(selectedPositive.after)-petScore(selectedNegative.after);
assert(marginAfter>marginBefore,'Bond training must rank a clear positive tactical alternative above an immediate-hang alternative more strongly.');
assert(bondReport.updatedPositions>0&&bondReport.updatedCoefficients>0&&bondReport.trainedPairs>0,'Match report must count real engine-consumed Bond coefficient changes from same-position contrasts.');
assert(brain.data.dualLora.bond.steps>0,'A confirmed trainer match must train Bond.');
assert.notDeepEqual(Array.from(brain.data.dualLora.bond.aW),bondBefore,'Bond Int8 coefficients should adapt after outcome feedback.');
assert(brain.latestMemory(),'A completed trainer game must create a readable episodic memory.');
assert.equal(brain.data.memories.length,1,'One completed trainer game should create one bounded life memory.');
assert.equal(brain.data.dualLora.arena.steps,0,'Trainer-specific feedback must not update Arena.');
assert.deepEqual(Array.from(brain.data.model.w1),Array.from(sharedModelBefore),'Pet-specific training must never mutate the shared V14 fallback checkpoint.');

// Arena experience is an explicitly separate update path.
const arenaBefore=Array.from(brain.data.dualLora.arena.aW);
brain.observePetMove(position,'e7e5',{side:'b'},1);
const unverifiedArena=brain.reinforce('win',null,{layer:'arena'});
assert.equal(unverifiedArena.reason,'arena-attestation-required','Unattested exhibitions must never update Arena.');
assert.equal(brain.data.dualLora.arena.steps,0,'Unattested exhibition feedback must leave Arena untouched.');
assert.deepEqual(Array.from(brain.data.dualLora.arena.aW),arenaBefore,'Unattested exhibition feedback must not mutate Arena coefficients.');
const arenaTraining=brain.trainDualAdapter(position,0.5,'b','arena',1,false);
assert(arenaTraining.trained,'The dedicated Arena adapter remains trainable for a future verified ingestion path.');
assert(brain.data.dualLora.arena.steps>0,'Arena adapter training must remain isolated and available to verified ingestion.');
assert.notDeepEqual(Array.from(brain.data.dualLora.arena.aW),arenaBefore,'Arena adapter weights should adapt independently when explicitly trained.');

// The retired self-play path cannot produce training updates.
const practiceResult=brain.reinforce('practice');assert.equal(practiceResult.reason,'practice-disabled');

// Compact v16 save stores only identity, traits, adapter blobs, memories and pending context.
const compact=brain.compactData();
assert.equal(compact.v,16);assert.equal(compact.i.length,8);assert.equal(compact.t.length,3);
for(const legacy of ['n','la','r','model','weights','policy','replay','v14Adapter'])assert(!(legacy in compact),`Legacy/shared payload ${legacy} must not enter .chelo.`);
const player={id:'local-player',handle:'trainer_1',displayName:'Trainer',settings:{},activeMatch:{version:4,mode:'human',movesPacked:Save.packMoves(['e2e4','e7e5'])}};
const packed=Save.encode({plan:'free',player,pets:[{id:'pet-1',data:compact}]});
assert(packed.bytes.byteLength<=100*1024,'Complete Free .chelo must fit 100 KiB.');
const restored=make();restored.importCompactData(Save.decode(packed.bytes,'free').pets[0].data);
for(const layer of ['bond','arena'])for(const tensor of ['aW','aB','b'])assert.deepEqual(Array.from(restored.data.dualLora[layer][tensor]),Array.from(brain.data.dualLora[layer][tensor]),`${layer}.${tensor} round trip`);
assert.equal(restored.latestMemory(),brain.latestMemory(),'Episodic life memories must survive .chelo export/import.');
assert.deepEqual(Array.from(Save.unpackMoves(Save.decode(packed.bytes,'free').player.activeMatch.movesPacked)),['e2e4','e7e5']);
const personality=make();personality.data.traits={bold:90,curious:20,patient:80};assert.equal(personality.personality(),'Calculated attacker','Personality should reflect the combined evolved trait profile.');
const storyteller=make();for(let i=0;i<15;i++){storyteller.observePetMove(position,'e7e5',{side:'b'},i+1);storyteller.reinforce(i%2?'win':'loss');}assert.equal(storyteller.data.memories.length,12,'Episodic life memory must retain only its bounded recent trail.');assert(storyteller.latestMemory(),'A pet with completed games should expose its newest story memory.');

const pro=make('pro');assert.equal(pro.limit,500*1024,'Pro budget is 500 KiB per pet, not per account.');
const five=Save.encode({plan:'pro',player,pets:Array.from({length:5},(_,i)=>({id:`pet-${i+1}`,data:pro.compactData()}))});
assert(five.bytes.byteLength<=5*500*1024+8192,'Five-pet Pro account file must fit the 2.5 MiB allowance plus header.');

const legacyV15Pet={v:15,i:['OldPet','old_pet','Old Trainer',1,100,1000,0,0,0,0,0],t:[50,50,50],m:[],o:[],r:[],u:[],g:[0,0,0,0,0],y:['Unbenchmarked',0,null],c:1,vv:1,dl:compact.dl};
const migrated=make();migrated.importSoul({format:'Chessling Soul',version:15,encoding:'legacy-import-only',pet:legacyV15Pet});
for(const layer of ['bond','arena'])for(const tensor of ['aW','aB','b'])assert.deepEqual(Array.from(migrated.data.dualLora[layer][tensor]),Array.from(brain.data.dualLora[layer][tensor]),`legacy V15 ${layer}.${tensor} migration`);

console.log(JSON.stringify({test:'M6 companion learning and memory contract',modelBytes:model.byteLength,sharedModelImmutable:true,bondSteps:brain.data.dualLora.bond.steps,arenaSteps:brain.data.dualLora.arena.steps,practiceUpdates:0,freeFileBytes:packed.bytes.byteLength,proFivePetBytes:five.bytes.byteLength,legacyImporter:'migration-only',profileSweep:{steps:profileSweep.length,monotonic:true},result:'PASS'},null,2));
