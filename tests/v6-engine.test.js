const fs=require('fs');
const vm=require('vm');
const path=require('path');
const context={window:{},TextEncoder,Date,Math,console};context.self=context.window;
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
const Chess=context.window.ChessCore,Brain=context.window.ChesslingBrain;
function assert(ok,message){if(!ok)throw new Error(message);}

// A side to move in a completed draw must not be asked to make another move.
const drawn=new Chess('7k/8/8/8/8/8/8/K6R w - - 150 1');
const drawBrain=new Brain('v6_draw',{persist:false,seed:41});
const drawResult=drawBrain.chooseMove(drawn,{maxDepth:1,timeMs:1000,nodeLimit:50000});
assert(drawResult.move===null&&drawResult.terminal===true,'Search should return a terminal result for an automatic 75-move draw.');

// A quiet checking move at halfmove 148 creates a quiescence line where a quiet
// evasion reaches the 75-move threshold. The quiescence search must see the draw.
const nearDraw=new Chess('7k/8/8/8/8/8/8/K6R w - - 148 1');
const qBrain=new Brain('v6_qdraw',{persist:false,seed:42});
const qResult=qBrain.chooseMove(nearDraw,{maxDepth:1,timeMs:1000,nodeLimit:50000,usePolicy:false});
assert(qResult.move===null||nearDraw.moves().includes(qResult.move),'Search returned an illegal move from the near-draw position.');
assert(qResult.drawNodes>0,'Quiescence did not count the 75-move draw while examining the quiet checking line.');
assert(nearDraw.fen()==='7k/8/8/8/8/8/8/K6R w - - 148 1','Search mutated the caller position while exploring.');

// Search control used by repeatable research; normal/default search stays capped at 5.
const opening=new Chess(),searchBrain=new Brain('v6_depth',{persist:false,seed:43});
const result=searchBrain.chooseMove(opening,{maxDepth:1,timeMs:1000,nodeLimit:50000,usePolicy:false});
assert(result.depth===1&&opening.moves().includes(result.move),'Depth-limited research search did not return a legal move at depth 1.');
assert(result.rootPvs===true,'Root principal-variation search was not active.');
assert(result.nodes>0&&typeof result.drawNodes==='number','Search diagnostics are incomplete.');
for(const flags of [{usePvs:true},{useHistory:true},{usePvs:true,useHistory:true},{rootPvs:false}]){
  const variant=searchBrain.chooseMove(opening,{maxDepth:2,timeMs:1000,nodeLimit:50000,usePolicy:false,...flags});
  assert(opening.moves().includes(variant.move),'Optional search variant returned an illegal move.');
  if(flags.rootPvs===false)assert(variant.rootPvs===false,'The full-window root-search control was not honoured.');
}
const fullWindowBrain=new Brain('v6_full_root',{persist:false,seed:44});
const pvsBrain=new Brain('v6_pvs_root',{persist:false,seed:44});
const fullWindow=fullWindowBrain.chooseMove(new Chess(),{maxDepth:2,timeMs:2000,nodeLimit:100000,usePolicy:false,rootPvs:false});
const rootPvs=pvsBrain.chooseMove(new Chess(),{maxDepth:2,timeMs:2000,nodeLimit:100000,usePolicy:false,rootPvs:true});
assert(fullWindow.depth===rootPvs.depth&&fullWindow.score===rootPvs.score&&fullWindow.move===rootPvs.move,'Root PVS disagrees with full-window search at the same completed depth on the opening position.');
const cappedPosition=new Chess('r2q1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP3PPP/R1BQ1RK1 w - - 0 10');
const cappedBefore=cappedPosition.fen();
const capped=new Brain('v6_capped',{persist:false,seed:46}).chooseMove(cappedPosition,{maxDepth:8,timeMs:2000,nodeLimit:1000,usePolicy:false});
assert(capped.interrupted===true&&capped.nodes>=1000&&cappedPosition.moves().includes(capped.move),'Node-limited search did not return an interruption-marked legal move.');
assert(cappedPosition.fen()===cappedBefore,'Interrupted search mutated the source position.');

console.log('Chelo V6 search regression tests passed: terminal draws, quiescence draw detection, legal search and immutable search root.');
