'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..'),root={};
const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/chelo-save.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context,{filename:file});
const Chess=root.ChessCore,Brain=root.CheloBrain,Save=root.CheloSave;
const binary=fs.readFileSync(path.join(base,'models/dual-nnue-v38-256.bin'));
root.CheloDualNNUE.model=root.CheloDualNNUE.parse(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));
const checkpoint=JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
function make(){const brain=new Brain('bond-lora-benchmark',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion,plan:'free'});brain.save=()=>true;return brain;}
function rng(seed){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
const probe=make();
function collectHoldout(seed,games,maxGroupsPerGame){
  const groups=[];
  for(let game=0;game<games;game++){
    const random=rng(seed+game),chess=new Chess();let ply=0,found=0;
    while(ply<70&&!chess.game_over()){
      const side=chess.turn(),fen=chess.fen(),legal=chess.moves({verbose:true,skipSan:true});if(!legal.length)break;
      if(side==='b'&&ply>8&&found<maxGroupsPerGame){
        const pairGroup=probe.tacticalMovePairs(fen,'b');
        if(pairGroup.positive.length&&pairGroup.negative.length){groups.push(pairGroup);found++;}
      }
      const move=legal[Math.floor(random()*legal.length)];chess.move(move.uci,{skipSan:true});ply++;
    }
  }
  return groups;
}
function flattenPairs(groups){
  const pairs=[];
  for(const group of groups){
    for(const positive of group.positive.slice(0,2))for(const negative of group.negative.slice(0,2))pairs.push({positive:positive.after,negative:negative.after});
  }
  return pairs;
}
function pairMargin(brain,pair,cache){
  const score=fen=>{
    if(!cache.has(fen)){const state=brain.dualNnueState(fen);cache.set(fen,state?(state.side===1?state.score:-state.score):0);}
    return cache.get(fen);
  };
  return score(pair.positive)-score(pair.negative);
}
function metric(brain,pairs){
  const cache=new Map();let correct=0,margin=0;
  for(const pair of pairs){const value=pairMargin(brain,pair,cache);if(value>0)correct++;margin+=value;}
  return {pairs:pairs.length,accuracy:+(correct/pairs.length).toFixed(5),meanMarginCp:+(margin/pairs.length).toFixed(1)};
}
function playTrainingGame(seed,brain){
  const random=rng(seed),chess=new Chess();let ply=0;
  while(ply<70&&!chess.game_over()){
    const side=chess.turn(),fen=chess.fen(),legal=chess.moves({verbose:true,skipSan:true});if(!legal.length)break;
    const move=legal[Math.floor(random()*legal.length)];chess.move(move.uci,{skipSan:true});ply++;
    if(side==='b')brain.observePetMove(fen,move.uci,{piece:move.piece,captured:move.captured,gaveCheck:chess.inCheck(),side:'b'},ply,chess);
    else brain.resolveLastPetMove(chess,move);
  }
  const outcome=chess.game_over()?(chess.result()==='b'?'win':chess.result()==='w'?'loss':'draw'):'draw';
  return brain.reinforce(outcome,chess);
}
function verifyExport(brain){
  const player={id:'local-player',handle:'lora_benchmark',displayName:'LoRA Benchmark',settings:{},createdAt:1,activePetId:'pet-1',activeMatch:null};
  const encoded=Save.encode({plan:'free',player,pets:[{id:'pet-1',data:brain.compactData()}]});
  assert(encoded.bytes.byteLength<=100*1024,'The complete Free .chelo must remain inside its 100 KiB limit.');
  const restored=make();restored.importCompactData(Save.decode(encoded.bytes,'free').pets[0].data);
  for(const tensor of ['aW','aB','b'])assert.deepEqual(Array.from(restored.data.dualLora.bond[tensor]),Array.from(brain.data.dualLora.bond[tensor]),`Bond ${tensor} must survive .chelo export/import exactly.`);
  assert.equal(restored.data.dualLora.bond.steps,brain.data.dualLora.bond.steps);
  return {bytes:encoded.bytes.byteLength,adapterRoundTrip:'exact'};
}

// Fixed hold-out data is generated from seeds never used for training.
const holdoutGroups=collectHoldout(67001,12,5),holdoutPairs=flattenPairs(holdoutGroups);
assert(holdoutGroups.length>=50&&holdoutPairs.length>=150,'The held-out tactical set must be large enough for a useful paired comparison.');
const baselineBrain=make(),baseline=metric(baselineBrain,holdoutPairs),baselineCache=new Map();
const hardest=holdoutPairs.map(pair=>({pair,margin:pairMargin(baselineBrain,pair,baselineCache)})).sort((a,b)=>a.margin-b.margin).slice(0,Math.max(1,Math.floor(holdoutPairs.length*0.4))).map(item=>item.pair);
const hardBaseline=metric(baselineBrain,hardest);
const milestones=[5,10,25,50],replicates=[];
for(const seedBase of [1000,2000,3000]){
  const brain=make(),rows=[];
  for(let game=1;game<=50;game++){
    const training=playTrainingGame(seedBase+game,brain);
    if(training.updatedCoefficients>0&&training.validationLossBefore!==null&&training.validationLossAfter!==null)assert(training.validationLossAfter<training.validationLossBefore,'Every accepted Bond update must reduce loss on its held-back parent positions.');
    if(milestones.includes(game))rows.push({
      games:game,acceptedBondSteps:brain.data.dualLora.bond.steps,
      trainedPairs:training.trainedPairs||0,changedCoefficients:training.updatedCoefficients||0,
      validationLossBefore:training.validationLossBefore,validationLossAfter:training.validationLossAfter,
      heldout:metric(brain,holdoutPairs),heldoutHard:metric(brain,hardest),save:verifyExport(brain)
    });
  }
  replicates.push({seedBase,rows});
}
const finalRows=replicates.map(run=>run.rows.find(row=>row.games===50));
const mean=(rows,key)=>rows.reduce((total,row)=>total+row[key],0)/rows.length;
const finalSummary={
  meanHeldoutMarginCp:+mean(finalRows.map(row=>row.heldout),'meanMarginCp').toFixed(1),
  meanHardMarginCp:+mean(finalRows.map(row=>row.heldoutHard),'meanMarginCp').toFixed(1),
  meanHeldoutAccuracy:+mean(finalRows.map(row=>row.heldout),'accuracy').toFixed(5),
  meanHardAccuracy:+mean(finalRows.map(row=>row.heldoutHard),'accuracy').toFixed(5),
  runsWithHigherOverallMargin:finalRows.filter(row=>row.heldout.meanMarginCp>baseline.meanMarginCp).length,
  runsWithHigherHardMargin:finalRows.filter(row=>row.heldoutHard.meanMarginCp>hardBaseline.meanMarginCp).length
};
const report={
  test:'Chelo Bond LoRA held-out counterfactual tactical-pair benchmark',
  model:'frozen V38 (256-neuron) base, per-pet rank-1 Bond bias adapter',
  training:{independentRuns:3,gamesPerRun:50,milestones,seedBases:[1000,2000,3000],gameCapPlies:70},
  holdout:{games:12,maxSampledPositionsPerGame:5,independentSeedBase:67001,parentPositions:holdoutGroups.length,positiveNegativeComparisons:holdoutPairs.length,baseline,hardest40Percent:{pairs:hardest.length,baseline:hardBaseline}},
  finalSummary,replicates,
  scope:'Each positive and negative candidate comes from the same legal parent position. Positives capture material or promote; negatives allow an immediate legal recapture of the moved piece. The learner mines hard contrasts, batches gradients, and accepts an update only when a separate set of parent positions has lower pairwise logistic loss. This is a one-ply tactical preference proxy, not Elo or match strength.'
};
console.log(JSON.stringify(report,null,2));
assert.equal(finalSummary.runsWithHigherOverallMargin,3,'All three independent 50-game runs should improve the held-out tactical margin.');
assert.equal(finalSummary.runsWithHigherHardMargin,3,'All three runs should improve the hardest held-out tactical contrasts.');
assert(finalSummary.meanHeldoutMarginCp>baseline.meanMarginCp*1.2,'Average held-out tactical margin should improve by at least 20%.');
assert(finalSummary.meanHardMarginCp>hardBaseline.meanMarginCp*1.3,'Average hard-set tactical margin should improve by at least 30%.');
assert(finalSummary.meanHeldoutAccuracy>=baseline.accuracy,'Mean held-out pair accuracy must not regress.');
assert(finalSummary.meanHardAccuracy>=hardBaseline.accuracy,'Mean hard-set pair accuracy must not regress.');
