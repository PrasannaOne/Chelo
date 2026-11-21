const fs=require('fs');
const vm=require('vm');
const path=require('path');
const context={window:{},TextEncoder,Date,Math,console,atob,btoa,performance};context.self=context.window;
vm.createContext(context);
for(const file of ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/chelo-save.js','src/soul/brain.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
const Chess=context.window.ChessCore;
const Brain=context.window.ChesslingBrain;
function assert(ok,message){if(!ok)throw new Error(message);}
function perft(chess,depth){if(!depth)return 1;let count=0;for(const move of chess.moves()){chess.move(move,{skipSan:true});count+=perft(chess,depth-1);chess.undo();}return count;}
function expectPerft(name,fen,expected){const chess=new Chess(fen);for(let d=1;d<=expected.length;d++){const actual=perft(chess,d);assert(actual===expected[d-1],`${name} perft(${d}) expected ${expected[d-1]} got ${actual}`);}}

expectPerft('Start','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',[20,400,8902,197281]);
expectPerft('Kiwipete','r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',[48,2039,97862]);
expectPerft('Position 3','8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',[14,191,2812]);
expectPerft('Position 4','r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',[6,264,9467]);
expectPerft('Position 5','rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',[44,1486,62379]);
expectPerft('Position 6','r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',[46,2079,89890]);

const game=new Chess();
for(const move of ['e2e4','e7e5','g1f3','b8c6','f1b5'])assert(game.move(move),`Illegal test move ${move}`);
assert(game.pgn()==='1. e4 e5 2. Nf3 Nc6 3. Bb5','SAN/PGN regression');
const ep=new Chess();for(const move of ['e2e4','a7a6','e4e5','d7d5'])assert(ep.move(move),`Illegal en-passant setup ${move}`);
assert(ep.moves().includes('e5d6')&&ep.move('e5d6')&&!ep.get('d5'),'En-passant regression');
const promotion=new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
assert(promotion.moves().includes('a7a8q')&&promotion.moves().includes('a7a8n')&&promotion.move('a7a8q'),'Promotion regression');
const castle=new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert(castle.moves().includes('e1g1')&&castle.moves().includes('e1c1')&&castle.move('e1g1')?.uci==='e1g1','Castling regression');
const mate=new Chess();for(const move of ['f2f3','e7e5','g2g4'])assert(mate.move(move),`Illegal mate setup ${move}`);
assert(mate.move('d8h4')?.san==='Qh4#'&&mate.game_over()&&mate.result()==='b','Checkmate regression');
const repetition=new Chess();for(let i=0;i<2;i++)for(const move of ['g1f3','g8f6','f3g1','f6g8'])assert(repetition.move(move),'Repetition setup failed');
assert(repetition.inThreefold()&&repetition.canClaimDraw(),'Threefold draw claim regression');

const fresh=new Brain('smoke',{persist:false});
assert(fresh.plan==='free'&&fresh.limit===97*1024,'Free pet payload must reserve room inside the 100 KiB whole-player file.');
assert(fresh.size()<fresh.limit,'Fresh V16 pet record does not fit its Free allocation.');
const freshChelo=context.window.CheloSave.encode({plan:'free',player:{id:'local-player',settings:{}},pets:[{id:'pet-1',data:fresh.compactData()}]});
assert(freshChelo.bytes.byteLength<2048,'Fresh .chelo should not duplicate hosted models or legacy learner tensors.');
assert(context.window.CheloSave.constants.FREE_FILE_BYTES===102400&&context.window.CheloSave.constants.FREE_PET_BYTES===99328,'Whole-file Free cap must be 100 KiB with the 97 KiB pet allocation.');
assert(fresh.data.model.w1.length===context.window.CHESSLING_MODEL_INPUTS*context.window.CHESSLING_MODEL_HIDDEN,'Unexpected V6 value model dimensions.');
assert(context.window.CHESSLING_MODEL_VECTOR_SIZE===80,'V6 sparse feature vector must be 80 compact values.');
assert(context.window.CHESSLING_MODEL_PARAMETERS>14940,'V6 model should be materially larger than V5.');
const start=new Chess();const move=fresh.chooseMove(start,{timeMs:350,nodeLimit:18000});
assert(start.moves().includes(move.move),`Search returned an illegal move: ${move.move}`);
const mateBrain=new Brain('mate',{persist:false});const matePosition=new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
const mateDecision=mateBrain.chooseMove(matePosition,{timeMs:500,nodeLimit:25000});
assert(mateDecision.move==='g6g7',`Search missed mate in one (${mateDecision.move}).`);

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','assets/style.css'),'utf8');
assert(/grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/.test(css)&&/grid-template-rows:repeat\(8,minmax\(0,1fr\)\)/.test(css),'Board must remain a true 8×8 grid.');
assert(html.includes('Chelo')&&html.includes('chelo')&&!html.includes('Chessling'), 'Product branding was not fully migrated.');
assert(!html.includes('Practice mode')&&!html.includes('Start practice')&&!html.includes('practiceStatus'),'Retired self-play/Practice UI must not reappear.');
assert(html.includes('Mastery')&&html.includes('Arena rank')&&!html.includes('Growth Elo'),'Public UI must separate Growth, Mastery and Arena rank rather than display Elo.');
const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
for(const asset of ['index.html','assets/style.css','src/engine/polyglot-random.js','models/polyglot-book.bin','src/engine/chess.js','src/soul/chelo-save.js','src/soul/brain.js','src/app/app.js','src/worker/ai-worker.js','src/engine/fast-search.js','assets/pieces.svg','models/base-v14-float32.json','models/dual-nnue-v37.bin'])assert(sw.includes(`'./${asset}'`),`PWA cache missing ${asset}`);
console.log('Chelo chess-core and UI smoke tests passed.');
console.log('Perft: start 20/400/8902/197281; Kiwipete 48/2039/97862; positions 3–6 verified.');
console.log(`V6 model: ${context.window.CHESSLING_MODEL_INPUTS} expanded feature weights · ${context.window.CHESSLING_MODEL_HIDDEN} hidden units · ${context.window.CHESSLING_MODEL_PARAMETERS} parameters; legal search and mate-in-one passed.`);
