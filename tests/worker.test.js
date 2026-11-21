const fs=require('fs');
const vm=require('vm');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const sent=[];let messageHandler=null;
const checkpoint=JSON.parse(fs.readFileSync(path.join(root,'models/base-v14-float32.json'),'utf8'));
const book=fs.readFileSync(path.join(root,'models','polyglot-book.bin'));
const dualNnue=fs.readFileSync(path.join(root,'models/dual-nnue-v37.bin'));
const cppWasm=fs.readFileSync(path.join(root,'wasm/chelo.wasm'));
const context={TextEncoder,Date,Math,console,WebAssembly,performance,Uint8Array,Uint16Array,Uint32Array,Float32Array,Int8Array,Int16Array,DataView,ArrayBuffer,SharedArrayBuffer,Atomics,Map,Set,Error,Number,Object,String,JSON,RegExp,Promise,atob,btoa,crypto,
  postMessage:message=>sent.push(message),
  addEventListener:(type,handler)=>{if(type==='message')messageHandler=handler;},
  importScripts:(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.resolve(root,'src/worker',file),'utf8'),context,{filename:file});},
  fetch:async url=>String(url).includes('models/base-v14-float32.json')?({ok:true,json:async()=>checkpoint}):String(url).includes('models/dual-nnue-v37.bin')?({ok:true,arrayBuffer:async()=>dualNnue.buffer.slice(dualNnue.byteOffset,dualNnue.byteOffset+dualNnue.byteLength)}):String(url).includes('wasm/chelo.wasm')?({ok:true,arrayBuffer:async()=>cppWasm.buffer.slice(cppWasm.byteOffset,cppWasm.byteOffset+cppWasm.byteLength)}):({ok:true,arrayBuffer:async()=>book.buffer.slice(book.byteOffset,book.byteOffset+book.byteLength)})
};
context.self=context;context.globalThis=context;vm.createContext(context);
(async()=>{
  vm.runInContext(fs.readFileSync(path.join(root,'src/worker/ai-worker.js'),'utf8'),context,{filename:'src/worker/ai-worker.js'});
  if(!messageHandler)throw new Error('AI worker did not register its message handler.');
  await messageHandler({data:{id:7,fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',brainData:{},plan:'free',maxTimeMs:80,maxNodes:1000,mode:'legacy',v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(sent.length!==1||sent[0].id!==7||!sent[0].ok||!sent[0].move||sent[0].book!==true)throw new Error('AI worker did not return a V14 legal Polyglot-book result.');
  if(sent[0].model!=='v15-dual-perspective-32-screlu+bond-arena-lora')throw new Error('AI worker returned the wrong frozen-base model identity.');
  const hardFen='r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  await messageHandler({data:{id:8,fen:hardFen,brainData:{},plan:'free',maxTimeMs:10000,maxNodes:900,mode:'legacy',v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(sent.length!==2||sent[1].id!==8||!sent[1].ok||!sent[1].fastBoard||sent[1].nodes!==900||sent[1].maxNodes!==900)throw new Error(`AI worker maxNodes budget failed: ${JSON.stringify(sent[1])}`);
  await messageHandler({data:{id:9,fen:hardFen,brainData:{},plan:'free',timeMs:10000,nodeLimit:900,mode:'legacy',v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(sent.length!==3||sent[2].id!==9||!sent[2].ok||sent[2].nodes!==900||sent[2].maxNodes!==900)throw new Error(`AI worker legacy timeMs/nodeLimit compatibility failed: ${JSON.stringify(sent[2])}`);

  const sharedTT=new SharedArrayBuffer((1<<18)*10*4);
  await messageHandler({data:{id:10,fen:hardFen,brainData:{},plan:'free',mode:'apex',workerRole:'apex-helper',workerId:1,sharedTTBuffer:sharedTT,maxTimeMs:10000,maxNodes:5000,maxDepth:4,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  const sharedWords=new Int32Array(sharedTT);
  if(sent.length!==4||sent[3].id!==10||!sent[3].ok||!sent[3].helper||sent[3].nodes!==5000)throw new Error(`Apex helper shared-TT search failed: ${JSON.stringify(sent[3])}`);
  if(!sharedWords.some((value,index)=>index>0&&value!==0))throw new Error('Apex helper did not publish any shared TT entry: '+JSON.stringify({result:sent[3],sample:Array.from(sharedWords.slice(0,20))}));

  await messageHandler({data:{id:11,fen:hardFen,brainData:{},plan:'free',mode:'rated',maxTimeMs:1,maxNodes:1,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  await messageHandler({data:{id:12,fen:hardFen,brainData:{},plan:'free',mode:'rated',maxTimeMs:999999,maxNodes:999999,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(!sent[4].ok||!sent[5].ok||sent[4].nodes!==30000||sent[5].nodes!==30000||sent[4].move!==sent[5].move||sent[4].score!==sent[5].score||!sent[4].dualPerspectiveNnue||!sent[5].dualPerspectiveNnue)throw new Error('Rated fairness mode was not deterministic at its fixed 30,000-node budget.');

  await messageHandler({data:{id:15,fen:hardFen,brainData:{},plan:'free',mode:'adaptive',maxTimeMs:10000,maxNodes:900,maxDepth:4,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(!sent[6].ok||!sent[6].cppEngine||sent[6].engine!=='cpp-wasm'||sent[6].engineFallback||sent[6].nodes!==900||sent[6].maxNodes!==900||sent[6].maxTimeMs!==10000||sent[6].depth>4)throw new Error(`Adaptive companion did not use the canonical C++/V37 engine within its personalised node budget: ${JSON.stringify(sent[6])}`);

  await messageHandler({data:{id:16,fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',brainData:{},plan:'free',mode:'adaptive',maxTimeMs:10000,maxNodes:900,maxDepth:4,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(!sent[7].ok||!sent[7].book||sent[7].engine!=='polyglot-book'||!sent[7].move)throw new Error(`Adaptive companion failed to retain the verified Polyglot opening book: ${JSON.stringify(sent[7])}`);

  await messageHandler({data:{id:13,fen:hardFen,brainData:{},plan:'free',mode:'apex',maxTimeMs:10000,maxNodes:1000,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(!sent[8].ok||sent[8].smpWorkers!==1||sent[8].sharedTranspositionTable!==false||!sent[8].smpFallbackReason)throw new Error('Apex did not safely fall back to one worker without cross-origin isolation.');

  await messageHandler({data:{id:14,fen:hardFen,brainData:{},plan:'free',mode:'legacy',useCppEngine:true,maxTimeMs:10000,maxNodes:1000,maxDepth:4,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(!sent[9].ok||!sent[9].cppEngine||sent[9].depth!==4||!sent[9].move)throw new Error(`C++ WASM Worker bridge failed: ${JSON.stringify(sent[9])}`);
  await messageHandler({data:{id:17,fen:hardFen,brainData:{},plan:'free',mode:'adaptive',maxTimeMs:10,maxNodes:10000000,maxDepth:32,v14Mode:true,baseVersion:checkpoint.baseVersion}});
  if(!sent[10].ok||!sent[10].cppEngine||sent[10].nodes>=10000000||sent[10].maxTimeMs!==10)throw new Error(`Adaptive C++ search did not respect the time cap as well as the node ceiling: ${JSON.stringify(sent[10])}`);
  console.log(`AI Worker M6 tests passed: book hit ${sent[0].move}; exact 900-node C++/V37 adaptive budget; Polyglot opening book; ranked JS fairness; shared SAB TT helper; legacy C++ time search and combined time ceiling passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
