const fs=require('fs');
const vm=require('vm');
const path=require('path');
const context={window:{},TextEncoder,Date,Math,console};
vm.createContext(context);
for(const file of ['chess.js','brain.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
const Brain=context.window.ChesslingBrain;
const Chess=context.window.ChessCore;
function assert(ok,message){if(!ok)throw new Error(message);}

const pet=new Brain('ml_test',{persist:false});
const zeros=Array(context.window.CHESSLING_MODEL_INPUTS).fill(0);
assert(pet.predict(zeros)===0,'Fresh model output must be neutral.');
assert(pet.data.model.w1.length===24*12&&pet.data.model.w2.length===12,'Unexpected neural model dimensions.');
assert(Object.keys(pet.data.weights).length===0,'Fresh pet must not retain the old fixed material-value table.');
assert(pet.data.model.w2.every(value=>value===0),'Output layer must begin neutral.');

// Synthetic supervised check: the network must learn a repeatable feature/outcome relationship.
const materialAdvantage=Array(24).fill(0);materialAdvantage[0]=75;
for(let i=0;i<800;i++)pet.trainSample(materialAdvantage,0.8);
const learned=pet.predict(pet.dequantise(materialAdvantage));
assert(learned>0.65,`Neural network did not learn a simple value signal (got ${learned.toFixed(3)}).`);
assert(pet.data.model.steps===800,'Training-step counter is incorrect.');

// The same feature should reverse sign when the point of view reverses.
const queenUp=new Chess('4k3/8/8/8/8/8/8/4K2Q w - - 0 1');
const whiteFeatures=pet.extractFeatures(queenUp,'w');
const blackFeatures=pet.extractFeatures(queenUp,'b');
assert(whiteFeatures[4]===1&&blackFeatures[4]===-1,'Material feature must be side-relative.');
assert(whiteFeatures.length===24,'Feature encoder shape changed.');

// TD update must be applied after the opponent's reply, and stored in the pet's own model.
const tdPet=new Brain('td_test',{persist:false});
const before=new Chess();
const startFen=before.fen();
const e4=before.move('e2e4');
tdPet.observePetMove(startFen,e4.uci,{piece:'p',side:'w'},1,before);
const e5=before.move('e7e5');
tdPet.resolveLastPetMove(before);
assert(tdPet.data.pending[0].r===1,'A response did not resolve the pending decision.');
assert(tdPet.data.model.steps===1,'Temporal-difference update was not applied.');

// Replay should deduplicate identical experience and remain bounded.
const replayPet=new Brain('replay_test',{persist:false});
for(let i=0;i<200;i++)replayPet.addReplay(materialAdvantage,0.7,0.5+i/1000);
assert(replayPet.data.replay.length===1,'Identical experiences should be consolidated.');
assert(replayPet.data.replay[0].n===200,'Consolidated experience visit count is wrong.');
assert(replayPet.data.replay[0].y===70,'Consolidated replay target was averaged with inconsistent units.');
const mixedReplay=new Brain('mixed_replay_test',{persist:false});
mixedReplay.addReplay(zeros,0.8,0.2);mixedReplay.addReplay(zeros,-0.2,0.9);
assert(mixedReplay.data.replay[0].y===30,'Mixed replay outcomes should average to +0.30.');
assert(mixedReplay.data.replay[0].p===90,'Replay priority should use a consistent integer scale.');
replayPet.replayLearn();
assert(replayPet.data.model.episodes===1&&replayPet.data.model.steps>0,'Replay training did not run.');

// V3 compact Souls remain importable, with a fresh V4 network initialized on migration.
const legacyV3={format:'Chessling Soul',version:3,encoding:'compact-json-v3',pet:{
  v:3,i:['OldPet','old_pet','Trainer',1,100,1000,0,0,0,0,0],
  w:[100,110,110,120,130,9000],a:[0,0,0,0],t:[50,50,50],m:[],h:[],o:[],q:[],g:[0,0,0,0,0],l:null,c:1,u:1
}};
const migrated=new Brain('migration_test',{persist:false});
migrated.importSoul(legacyV3);
assert(migrated.data.petName==='OldPet'&&migrated.data.model.w1.length===288,'V3 Soul migration did not initialise the V4 model.');


// Expanded older Souls can be migrated too.
const legacyV2={format:'Chessling Soul',version:2,pet:{
  schema:2,petName:'OldTwo',handle:'old_two',trainerName:'Trainer',gen:1,elo:100,
  weights:{p:100,n:110,b:110,r:120,q:130,k:9000},policy:{center:0,advance:0,development:0,shelter:0},
  traits:{bold:50,curious:50,patient:50},memory:{},humanOpenings:{},openingReplies:{},pending:[],geneticTrace:{p:0,n:0,b:0,r:0,q:0}
}};
const migratedV2=new Brain('migration_v2',{persist:false});
migratedV2.importSoul(legacyV2);
assert(migratedV2.data.petName==='OldTwo'&&migratedV2.data.model.w1.length===288,'Expanded V2 Soul migration failed.');
assert(migratedV2.data.weights.q===130,'Legacy V2 material data was not retained for compatibility.');

// A short real legal self-play segment exercises feature extraction and move search together.
const sparPet=new Brain('spar_segment',{persist:false});
const spar=new Chess();
for(let ply=0;ply<10&&!spar.game_over();ply++){
  const fen=spar.fen(),side=spar.turn();
  const decision=sparPet.chooseMove(spar,{timeMs:85,nodeLimit:4500});
  const played=spar.move(decision.move);
  assert(played,`Neural search returned an illegal move at self-play ply ${ply+1}.`);
  sparPet.resolveLastPetMove(spar);
  sparPet.observePetMove(fen,played.uci,{piece:played.piece,captured:played.captured,gaveCheck:/[+#]$/.test(played.san),side},spar.historyMoves().length,spar);
}
assert(sparPet.data.pending.length>0&&sparPet.data.model.steps>0,'Real self-play did not feed the learning loop.');

// A trained Soul must restore the exact neural weights and stay inside 50 KiB.
const soul=JSON.parse(pet.exportSoul());
const restored=new Brain('ml_restore',{persist:false});
restored.importSoul(soul);
assert(Math.abs(restored.predict(restored.dequantise(materialAdvantage))-learned)<1e-5,'Soul did not preserve neural predictions.');
assert(restored.size()<=51200,'Restored brain exceeds the strict storage budget.');

console.log('Chessling V4 machine-learning tests passed.');
console.log(`Synthetic value learning: ${learned.toFixed(3)} after 800 updates; TD updates: ${tdPet.data.model.steps}; Soul: ${restored.size()} bytes.`);
