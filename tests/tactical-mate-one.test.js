'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const base = path.resolve(__dirname, '..');
const files = ['src/engine/polyglot-random.js','src/engine/chess.js','src/engine/endgame-kpk.js','src/engine/fast-search.js','src/nnue/dual-nnue.js','src/soul/brain.js'];
const checkpoint = JSON.parse(fs.readFileSync(path.join(base,'models/base-v14-float32.json'),'utf8'));
const puzzleSet = JSON.parse(fs.readFileSync(path.join(base,'benchmarks/data/mate-in-one-50.json'),'utf8'));
function loadModel(file) {
  const root = {};
  const context = {window:root,self:root,globalThis:root,TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,Int32Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Math,Date,JSON,Number,String,Object,Error,RegExp,Promise,console,performance,atob,btoa};
  vm.createContext(context);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),context,{filename:f});
  const bytes = fs.readFileSync(file);
  root.CheloDualNNUE.model = root.CheloDualNNUE.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const brain = new root.CheloBrain('chelo-tactical-test',{persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
  return {root,brain,sha:crypto.createHash('sha256').update(bytes).digest('hex')};
}
function run(label,file) {
  const engine=loadModel(file);let mates=0,illegal=0,wrong=0,totalNodes=0;
  for(const puzzle of puzzleSet.puzzles){
    const game=new engine.root.ChessCore(puzzle.fen);
    const result=engine.brain.chooseMove(game,{maxNodes:8000,deterministicNodes:true,bookBinary:null,usePolicy:false});
    totalNodes+=result.nodes;
    const move=game.move(result.move,{skipSan:true});
    if(!move){illegal++;continue;}
    if(game.inCheckmate())mates++;else wrong++;
  }
  return {label,sha256:engine.sha,positions:puzzleSet.puzzles.length,foundMateInOne:mates,wrongNonMateMoves:wrong,illegalMoves:illegal,totalNodes};
}
const v38=run('Stage 3.8 (256-neuron)',path.join(base,'models/dual-nnue-v38-256.bin'));
assert.equal(v38.foundMateInOne,50);assert.equal(v38.illegalMoves,0);assert.equal(v38.wrongNonMateMoves,0);
console.log(JSON.stringify({format:'Chelo tactical retention subset: 50 verified mate-in-one positions',source:puzzleSet.title,protocol:{nodesPerPosition:8000,deterministicNodeBudget:true,policy:false,openingBook:false},results:[v38],scope:'Narrow mate-in-one retention subset only; not a substitute for full WAC, Eigenmann or STS suites.'},null,2));
