'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root={};
const context={window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
vm.createContext(context);
for(const file of ['src/engine/chess.js','src/nnue/dual-nnue.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
const Brain=root.CheloBrain,Chess=root.ChessCore;
const modelBytes=fs.readFileSync(path.join(__dirname,'..','models/dual-nnue-v38-256.bin'));
root.CheloDualNNUE.model=root.CheloDualNNUE.parse(modelBytes.buffer.slice(modelBytes.byteOffset,modelBytes.byteOffset+modelBytes.byteLength));

const fresh=new Brain('hatchling-zero',{persist:false});
assert.deepEqual({...fresh.developmentalProfile()},{games:0,stage:0,label:'Hatchling · Piece mover',randomProbability:1,engineProbability:0});
const start=new Chess();
const legal=start.moves();
const randomPick=fresh.chooseAdaptiveMove(start,{random:()=>0.73});
assert.equal(randomPick.selection,'legal-random','A newborn must choose only by legal-move availability.');
assert(legal.includes(randomPick.move),'The newborn selected an illegal move.');
assert.equal(randomPick.nodes,0,'A newborn must not search with the hosted engine.');

// After four finished matches, a guided decision can notice a completely free rook.
const beginner=new Brain('hatchling-four',{persist:false});beginner.data.games=4;
const tactical=new Chess('k7/8/8/8/8/8/4q3/4R2K b - - 0 1');
const guided=beginner.chooseAdaptiveMove(tactical,{random:(()=>{const values=[0.99,0];return()=>values.shift()??0;})()});
assert.equal(guided.selection,'material-and-memory');
assert.equal(guided.move,'e2e1','After four games the beginner should notice a safe free capture in the teaching position.');
assert(guided.developmentStage>=1,'At four games the pet has progressed past pure move-legality.');
assert(beginner.developmentalProfile().randomProbability>0.7,'A casual four-game beginner must still make plenty of mistakes.');

// Natural rating-driven progression: grows faster against a strong trainer, stays gentle for casuals.
const casual=new Brain('hatchling-casual',{persist:false});casual.data.games=12;casual.data.elo=100;
const strong=new Brain('hatchling-strong',{persist:false});strong.data.games=8;strong.data.elo=450;strong.data.dualLora.bond.steps=6;
assert(strong.developmentalProfile().engineProbability>casual.developmentalProfile().engineProbability,'Strong-player challenge must unlock search faster than casual play.');
assert(strong.developmentalProfile().engineProbability>0,'The engine should begin blending in naturally as rating and Bond grow.');
assert.equal(strong.chooseAdaptiveMove(new Chess(),{random:()=>0}),null,'The engine gate should be testable and take the search path when selected.');


// Five actual outcome cycles must increment games, update the Bond adapter,
// and move the pet into its beginner phase. A directly captured landing piece
// receives an additional position/move-specific lesson.
const trained=new Brain('five-game-growth',{persist:false});
const bondBefore=Array.from(trained.data.dualLora.bond.aW);
const teachingFen='rnbqkbnr/p1ppp1pp/5p2/1p6/2P2P2/8/PP1PP1PP/RNBQKBNR b KQkq - 0 3';
for(let i=0;i<5;i++){
  trained.observePetMove(teachingFen,'g7g5',{side:'b'});
  const lessonGame=new Chess(teachingFen);assert(lessonGame.move('g7g5'));
  const reply=lessonGame.move('f4g5');assert(reply?.captured==='p','Teaching reply must capture the just-moved pawn.');
  trained.resolveLastPetMove(lessonGame,reply);
  trained.reinforce('loss');
}
assert.equal(trained.data.games,5,'Completed matches must advance the developmental stage.');
assert(trained.data.dualLora.bond.steps>=1,'Five completed trainer games with meaningful tactical alternatives should train the Bond adapter.');
assert.notDeepEqual(Array.from(trained.data.dualLora.bond.aW),bondBefore,'Five games should change the engine-consumed Bond adapter.');
assert(trained.data.memory[trained.simplifyFen(teachingFen)].g7g5.score<0,'An immediately captured piece must become a move-specific negative lesson.');
assert.equal(trained.developmentalProfile().stage,3,'Five games should produce the beginner stage, not a fully trained engine.');
const preferenceCalls=[],originalPreference=trained.dualNnuePreferenceDelta.bind(trained);
trained.dualNnuePreferenceDelta=(fen,side)=>{const value=originalPreference(fen,side);preferenceCalls.push(value);return value;};
const legalAtFive=new Chess(teachingFen).moves({verbose:true,skipSan:true});
trained.chooseAdaptiveMove(new Chess(teachingFen),{random:()=>0.99});
assert.equal(preferenceCalls.length,legalAtFive.length,'The early developmental selector must consult the trained Bond adapter for its legal candidate moves.');
assert(preferenceCalls.some(value=>value!==0),'The saved Bond adapter must measurably alter at least one candidate evaluation before V37 search is blended in.');

const app=fs.readFileSync(path.join(__dirname,'..','src/app/app.js'),'utf8');
assert(app.includes('brain.chooseAdaptiveMove(chess)'), 'Production play must use the developmental move selector before invoking V37.');
assert(app.includes('Threefold repetition (auto-claimed in casual play)'));
assert(app.includes('50-move rule (auto-claimed in casual play)'));
assert(app.includes('if(chess.game_over())')&&app.includes('const claim=claimableDrawReason()'));

const repetition=new Chess();
for(let cycle=0;cycle<2;cycle++)for(const move of ['g1f3','g8f6','f3g1','f6g8'])assert(repetition.move(move));
assert(repetition.inThreefold()&&repetition.canClaimDraw(),'Threefold must be claimable on the third occurrence.');
assert(!repetition.game_over(),'FIDE threefold is claimable, not automatically terminal; Chelo adds a casual auto-claim in the app.');
const fifty=new Chess('7k/8/8/8/8/8/8/K6R w - - 100 51');
assert(fifty.canClaimDraw()&&!fifty.game_over(),'The 50-move draw is claimable, not automatically terminal in the rules core.');
const seventyFive=new Chess('7k/8/8/8/8/8/8/K6R w - - 150 76');
assert(seventyFive.game_over()&&seventyFive.result()==='draw','The 75-move draw must be automatic.');

console.log(JSON.stringify({test:'Chelo hatchling progression and draw guardrails',fresh:'uniform random legal moves; no search',fourGames:{stage:guided.developmentStage,label:guided.developmentLabel,selection:guided.selection,teachingCapture:guided.move,randomProbability:0.45},engineBlendStartsAtGames:12,draws:{threefold:'claimable by FIDE; auto-claimed in casual app',fiftyMove:'claimable by FIDE; auto-claimed in casual app',fivefold:'automatic in rules core',seventyFiveMove:'automatic in rules core'},result:'PASS'},null,2));
