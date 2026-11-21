'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const rootDir = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'src/engine/fast-search.js'), 'utf8');
function loadFastTT() {
  const root = {};
  const context = { window:root, self:root, globalThis:root, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, DataView, ArrayBuffer, SharedArrayBuffer, Atomics, Math, Number, String, Object, Error, Map, Set, Date, JSON, performance, console };
  vm.createContext(context);
  vm.runInContext(source, context, { filename:'fast-search.js' });
  return root.CheloFastTT;
}
const FastTT = loadFastTT();
assert.equal(typeof FastTT, 'function');
const out = new Int32Array(4);
const local = new FastTT();
const a = [7, 11, 13, 17], b = [6, 11, 9, 17];
local.store(...a, 8, 1234, 1, 0x123456, 0);
local.probe(...b, 1, -32000, 32000, 0, out);
assert.equal(out[0], 0, 'local TT collision must fail full-key verification');
local.probe(...a, 1, -32000, 32000, 0, out);
assert.equal(out[0], 1); assert.equal(out[2], 1234); assert.equal(out[1], 0x123456);
local.store(...b, 9, -321, 1, 0x654321, 0);
local.probe(...a, 1, -32000, 32000, 0, out);
assert.equal(out[0], 0, 'overwritten direct-map slot must not return the prior key');

const shared = new SharedArrayBuffer((1 << 18) * 10 * 4);
const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  const vm = require('node:vm');
  const root = {};
  const context = { window:root, self:root, globalThis:root, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, DataView, ArrayBuffer, SharedArrayBuffer, Atomics, Math, Number, String, Object, Error, Map, Set, Date, JSON, performance, console };
  vm.createContext(context); vm.runInContext(workerData.source, context);
  const table = new root.CheloFastTT(workerData.buffer), out = new Int32Array(4);
  const id = workerData.id, key = [id + 1, 0, (id + 1) << 2, 0], score = 1000 + id, move = 0x1200 + id;
  let hits = 0, corrupt = 0;
  for (let i = 0; i < 50000; i++) {
    table.store(...key, 8, score, 1, move, 0);
    table.probe(...key, 1, -32000, 32000, 0, out);
    if (out[0]) { hits++; if (out[2] !== score || out[1] !== move) corrupt++; }
  }
  parentPort.postMessage({ id, hits, corrupt, stores:table.stores });
`;
const workers = Array.from({length:4}, (_,id) => new Promise((resolve,reject) => {
  const worker = new Worker(workerSource, {eval:true, workerData:{source,buffer:shared,id}});
  const timer = setTimeout(() => { worker.terminate(); reject(new Error(`TT worker ${id} timed out`)); }, 20000);
  worker.once('message', result => { clearTimeout(timer); resolve(result); });
  worker.once('error', error => { clearTimeout(timer); reject(error); });
  worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error(`TT worker ${id} exited ${code}`)); } });
}));
Promise.all(workers).then(results => {
  const corrupt = results.reduce((sum, result) => sum + result.corrupt, 0);
  assert.equal(corrupt, 0, 'shared TT returned a torn/corrupt best move or score');
  assert.equal(results.length, 4);
  console.log(JSON.stringify({format:'Chelo Shared TT collision/race stress',workers:4,writesPerWorker:50000,totalWrites:200000,allWorkersCompleted:true,corruptHits:corrupt,workerResults:results}, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
