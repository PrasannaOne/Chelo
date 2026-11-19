const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');
const sent = [];
let messageHandler = null;
const context = {
  TextEncoder, Date, Math, console,
  postMessage: message => sent.push(message),
  addEventListener: (type, handler) => { if (type === 'message') messageHandler = handler; },
  importScripts: (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
  }
};
context.self = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'ai-worker.js'), 'utf8'), context, {filename:'ai-worker.js'});
if (!messageHandler) throw new Error('AI worker did not register its message handler.');
messageHandler({data:{id:7,fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',brainData:{elo:100},timeMs:180,nodeLimit:6000}});
if (sent.length !== 1 || sent[0].id !== 7 || !sent[0].ok || !sent[0].move) throw new Error('AI worker did not return a valid response.');
console.log(`AI Worker test passed: ${sent[0].move}, depth ${sent[0].depth}, ${sent[0].nodes} nodes.`);
