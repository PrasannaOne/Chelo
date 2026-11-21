/* Chelo search worker. Shared checkpoints stay immutable; per-pet Bond/Arena adapters live in .chelo data. */
importScripts('../engine/polyglot-random.js', '../engine/chess.js', '../engine/endgame-kpk.js', '../engine/fast-search.js', '../nnue/dual-nnue.js', '../soul/brain.js');
const BASE_URL = '../../models/base-v14-float32.json';
const BOOK_URL = '../../models/polyglot-book.bin';
const DUAL_NNUE_URL = '../../models/dual-nnue-v38-256.bin';
const CPP_WASM_URL = '../../wasm/chelo.wasm';
let dualModelBuffer = null;
let cppWasmPromise = null;
const DUAL_NNUE_SHA256 = 'e14650d8f4ff79eb0197ab06fa7f6f370d53cc019289fde6f103e367db257826';
const PET_BASE_VERSION = 'v13-f32-policy-2026-11-19-seed-20261119';
const SMP_MAX_WORKERS = 4;
const SMP_GLOBAL_STOP = 0;
const SMP_DONE_COUNT = 1;
const SMP_GLOBAL_WORDS = 8;
const SMP_LANE_WORDS = 20;
const SMP_SLOT_BANKS = 2;
const SMP_SLOT_BYTES = 512 * 1024 + 256 + 16; // Supports one maximum-size Pro pet adapter/memory snapshot.
const SMP_FEN_CAP = 256;
const SMP_PET_DATA_OFFSET = SMP_FEN_CAP;
const SMP_PET_DATA_CAP = 512 * 1024;
const SMP_MOVE_OFFSET = SMP_SLOT_BYTES - 16;
const LANE_GEN = 0, LANE_STATE = 1, LANE_FEN_LEN = 2, LANE_PET_DATA_LEN = 3;
const LANE_MAX_NODES = 4, LANE_TIME_MS = 5, LANE_MAX_DEPTH = 6, LANE_START_DEPTH = 7;
const LANE_NODES = 8, LANE_DEPTH = 9, LANE_SCORE = 10, LANE_MOVE_LEN = 11, LANE_ERROR = 12;
const LANE_START_PUBLISH_US = 13, LANE_START_LATENCY_US = 14;
const LANE_STOP = 15, LANE_RESULT_SEQ = 16, LANE_RESULT_GEN = 17, LANE_DONE_GEN = 18;
const SMP_IDLE = 0, SMP_RUNNING = 1, SMP_DONE = 2, SMP_ERROR = 3;
let basePromise = null;
let bookPromise = null;
let dualModelPromise = null;
let apexPool = null;
function loadPetBaseModel(){
  if(!basePromise)basePromise=fetch(BASE_URL,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`Chelo pet-learning base unavailable (${r.status}).`);return r.json();}).then(x=>{if(x?.version!==14||x?.baseVersion!==PET_BASE_VERSION||!x?.tensors)throw new Error('Chelo pet-learning base identity mismatch.');return x;}).catch(e=>{basePromise=null;throw e;});
  return basePromise;
}
function loadBook(){
  if(!bookPromise)bookPromise=fetch(BOOK_URL).then(r=>{if(!r.ok)throw new Error(`Opening book unavailable (${r.status}).`);return r.arrayBuffer();}).then(buffer=>{const bytes=new Uint8Array(buffer);if(bytes.length!==20480||bytes.length%16)throw new Error('Polyglot book failed its 16-byte record check.');return bytes;}).catch(error=>{console.warn('Chelo is continuing without the optional opening book.',error);bookPromise=Promise.resolve(null);return null;});
  return bookPromise;
}
function loadDualModel(){
  if(!dualModelPromise)dualModelPromise=fetch(DUAL_NNUE_URL,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`Stage 3.7 NNUE binary unavailable (${r.status}).`);return r.arrayBuffer();}).then(async buffer=>{
    if(typeof crypto==='undefined'||!crypto.subtle)throw new Error('Secure SHA-256 verification is unavailable in this worker.');const digest=await crypto.subtle.digest('SHA-256',buffer),hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');if(hex!==DUAL_NNUE_SHA256)throw new Error('Chelo Stage 3.7 NNUE SHA-256 mismatch.');
    dualModelBuffer=buffer.slice(0);const model=self.CheloDualNNUE.parse(buffer);self.CheloDualNNUE.model=model;return model;
  }).catch(error=>{dualModelPromise=null;throw error;});
  return dualModelPromise;
}
async function loadCppEngine(){
  if(!cppWasmPromise)cppWasmPromise=(async()=>{
    if(typeof WebAssembly==='undefined')throw new Error('WebAssembly is unavailable.');
    const [response]=await Promise.all([fetch(CPP_WASM_URL,{cache:'no-cache'}),loadDualModel()]);
    if(!response.ok)throw new Error(`Chelo C++ WebAssembly unavailable (${response.status}).`);
    const bytes=await response.arrayBuffer();
    const loaded=await WebAssembly.instantiate(bytes,{env:{chelo_host_now_ms:()=>BigInt(Math.floor(performance.now()))}});
    const instance=loaded.instance||loaded, e=instance.exports;
    if(e.__wasm_call_ctors)e.__wasm_call_ctors();
    if(e.chelo_abi_version()!==1)throw new Error('Chelo C++ WASM ABI mismatch.');
    const memory=e.memory, modelPtr=e.chelo_model_buffer();
    if(e.chelo_model_buffer_size()!==dualModelBuffer.byteLength)throw new Error('WASM binary requires rebuild for 256-neuron V38 model.');new Uint8Array(memory.buffer,modelPtr,e.chelo_model_buffer_size()).set(new Uint8Array(dualModelBuffer));
    if(!e.chelo_load_model())throw new Error('C++ engine rejected the pinned V37 model.');
    const kpk=self.CHESSLING_KPK_WDL;
    if(kpk&&kpk.length===24576){new Uint8Array(memory.buffer,e.chelo_kpk_buffer(),24576).set(kpk);e.chelo_load_kpk();}
    return {instance,e,memory};
  })().catch(error=>{cppWasmPromise=null;throw error;});
  return cppWasmPromise;
}
function encodeCppAdapter(adapter,rank){
  const bytes=new Uint8Array(4+513*rank);bytes[0]=rank;bytes[1]=Math.max(0,Math.min(14,Number(adapter?.shift??8)|0));
  const aw=adapter?.aW||[],ab=adapter?.aB||[],b=adapter?.b||[];let at=4;
  for(let i=0;i<256*rank;i++)bytes[at++]=(Number(aw[i])||0)&255;
  for(let i=0;i<256*rank;i++)bytes[at++]=(Number(ab[i])||0)&255;
  for(let i=0;i<rank;i++)bytes[at++]=(Number(b[i])||0)&255;
  return bytes;
}
async function tryCppSearch(chess,brain,timeBudget,maxDepth,nodeBudget=0){
  const wasm=await loadCppEngine(),e=wasm.e,memory=wasm.memory;
  const petData=brain.data?.dualLora||{};
  for(const [which,key,rank] of [[0,'bond',1],[1,'arena',2]]){
    const bytes=encodeCppAdapter(petData[key],rank),ptr=e.chelo_adapter_buffer(which);
    new Uint8Array(memory.buffer,ptr,e.chelo_adapter_buffer_size(which)).set(bytes);
    if(!e.chelo_load_adapter(which,bytes.length))throw new Error(`C++ engine rejected ${key} adapter.`);
  }
  const fen=chess.fen(),encoded=new TextEncoder().encode(fen),fenPtr=e.chelo_fen_buffer();
  if(encoded.length>=128)throw new Error('FEN exceeds C++ bridge capacity.');
  const view=new Uint8Array(memory.buffer);view.fill(0,fenPtr,fenPtr+128);view.set(encoded,fenPtr);
  if(!e.chelo_set_fen(fenPtr))throw new Error('C++ engine rejected the current FEN.');
  const depthLimit=Math.max(1,Math.min(32,maxDepth));
  // Adaptive companion searches are bounded by the pet's personalised node
  // budget. This keeps the challenge curve deterministic across devices; the
  // time budget remains a safety fallback for callers without a node budget.
  const fixedNodes=Math.max(0,Math.floor(Number(nodeBudget)||0));
  const boundedTime=Math.max(10,Math.floor(Number(timeBudget)||250));
  const resultPtr=fixedNodes>0&&typeof e.chelo_search_limited==='function'
    ?e.chelo_search_limited(depthLimit,boundedTime,BigInt(fixedNodes))
    :fixedNodes>0&&typeof e.chelo_search_nodes==='function'
      ?e.chelo_search_nodes(depthLimit,BigInt(fixedNodes))
      :e.chelo_search(depthLimit,boundedTime);
  const movePtr=e.chelo_bestmove_text();let move='';for(let i=0;i<6;i++){const c=view[movePtr+i];if(!c)break;move+=String.fromCharCode(c);}
  const dv=new DataView(memory.buffer),normalNodes=Number(dv.getBigUint64(resultPtr+16,true)),qnodes=Number(dv.getBigUint64(resultPtr+24,true));
  return {move,score:dv.getInt32(resultPtr+4,true),depth:dv.getInt32(resultPtr+8,true),nodes:normalNodes+qnodes,normalNodes,qnodes,maxNodes:fixedNodes||undefined,maxTimeMs:boundedTime,scoreExact:true,scoreBound:'exact',cppEngine:true,engine:'cpp-wasm',model:'chelo-v15-cpp-v37-dual-nnue'};
}
function laneBase(lane){return SMP_GLOBAL_WORDS+lane*SMP_LANE_WORDS;}
function laneByteOffset(lane,generation){return (SMP_GLOBAL_WORDS+SMP_MAX_WORKERS*SMP_LANE_WORDS)*4+(lane*SMP_SLOT_BANKS+(generation&1))*SMP_SLOT_BYTES;}
function scoreSearchResults(mainResult,helpers){
  const mainDepth=Number(mainResult.depth)||0;
  let best={...mainResult,workerId:0,scoreExact:mainResult.scoreExact===true};
  for(let i=0;i<helpers.length;i++){
    const candidate=helpers[i];
    if(!candidate||!candidate.move||candidate.scoreExact!==true||!Number.isFinite(candidate.score))continue;
    const depth=Number(candidate.depth)||0;
    if(depth<=mainDepth)continue;
    if(depth>best.depth||(depth===best.depth&&candidate.score>best.score))best=candidate;
  }
  // At exactly the main thread's completed depth, a helper may replace it only
  // with an explicitly exact score that is strictly higher. Ties stay on main.
  for(let i=0;i<helpers.length;i++){
    const candidate=helpers[i];
    if(!candidate||!candidate.move||candidate.scoreExact!==true||!Number.isFinite(candidate.score))continue;
    const depth=Number(candidate.depth)||0;
    if(depth===mainDepth&&candidate.score>mainResult.score&&best.depth===mainDepth&&candidate.score>best.score)best=candidate;
  }
  return best;
}
async function createApexPool(workerCount,plan){
  const helpers=workerCount-1;
  if(helpers<=0||typeof SharedArrayBuffer==='undefined'||typeof Worker==='undefined'||self.crossOriginIsolated!==true)return null;
  const controlBytes=(SMP_GLOBAL_WORDS+SMP_MAX_WORKERS*SMP_LANE_WORDS)*4+SMP_MAX_WORKERS*SMP_SLOT_BANKS*SMP_SLOT_BYTES;
  const controlBuffer=new SharedArrayBuffer(controlBytes);
  const sharedTTBuffer=new SharedArrayBuffer((1<<18)*10*4);
  const control=new Int32Array(controlBuffer);
  const helperWorkers=[];
  const readyPromises=[];
  const startupId='smp-init-'+Date.now()+'-'+Math.floor(Math.random()*0x7fffffff);
  for(let workerId=1;workerId<=helpers;workerId++){
    const lane=workerId-1;
    const helper=new Worker(self.location.href);
    helperWorkers.push(helper);
    readyPromises.push(new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Apex helper ${workerId} did not become ready.`)),5000);
      helper.onmessage=event=>{
        if(event.data?.id!==startupId)return;
        clearTimeout(timer);
        if(event.data.ok&&event.data.ready)resolve(event.data);
        else reject(new Error(event.data.error||`Apex helper ${workerId} failed startup.`));
      };
      helper.onerror=event=>{clearTimeout(timer);reject(new Error(event.message||`Apex helper ${workerId} crashed.`));};
    }));
    helper.postMessage({id:startupId,workerRole:'smp-persistent-helper',workerId,lane,controlBuffer,sharedTTBuffer,plan,v14Mode:true,baseVersion:PET_BASE_VERSION});
  }
  try{
    const ready=await Promise.all(readyPromises);
    return {workerCount:ready.length+1,helpers:helperWorkers,controlBuffer,control,sharedTTBuffer,createdAt:Date.now()};
  }catch(error){for(const helper of helperWorkers)try{helper.terminate();}catch(_){};console.warn('Chelo Apex is falling back to one worker:',error);return null;}
}
function writeHelperCommand(pool,workerId,fen,petDataBytes,options){
  const lane=workerId-1,base=laneBase(lane),control=pool.control,bytes=new Uint8Array(pool.controlBuffer);
  if(fen.length>=SMP_FEN_CAP||petDataBytes.length>SMP_PET_DATA_CAP)throw new Error('Apex shared pet snapshot exceeded its fixed command slot.');
  const generation=(Atomics.load(control,base+LANE_GEN)+1)|0,offset=laneByteOffset(lane,generation);
  for(let i=0;i<fen.length;i++)bytes[offset+i]=fen.charCodeAt(i)&255;
  bytes.set(petDataBytes,offset+SMP_PET_DATA_OFFSET);
  Atomics.store(control,base+LANE_STATE,SMP_RUNNING);
  Atomics.store(control,base+LANE_FEN_LEN,fen.length);
  Atomics.store(control,base+LANE_PET_DATA_LEN,petDataBytes.length);
  Atomics.store(control,base+LANE_MAX_NODES,Math.max(1,Math.floor(Number(options.maxNodes)||10000000)));
  Atomics.store(control,base+LANE_TIME_MS,Math.max(10,Math.floor(Number(options.maxTimeMs)||40)));
  Atomics.store(control,base+LANE_MAX_DEPTH,Math.max(1,Math.min(80,Math.floor(Number(options.maxDepth)||10))));
  Atomics.store(control,base+LANE_START_DEPTH,1+(workerId&1));
  Atomics.store(control,base+LANE_ERROR,0);
  Atomics.store(control,base+LANE_STOP,generation);
  Atomics.store(control,base+LANE_START_PUBLISH_US,Math.round(((performance.timeOrigin||0)+performance.now())*1000));
  Atomics.store(control,base+LANE_START_LATENCY_US,0);
  Atomics.store(control,base+LANE_GEN,generation);
  Atomics.notify(control,base+LANE_GEN,1);
}
function readHelperResult(pool,workerId){
  const lane=workerId-1,base=laneBase(lane),control=pool.control;
  const generation=Atomics.load(control,base+LANE_GEN),seqWord=base+LANE_RESULT_SEQ;
  for(let retry=0;retry<3;retry++){
    const before=Atomics.load(control,seqWord);
    if(before===0||(before&1))continue;
    if(Atomics.load(control,base+LANE_RESULT_GEN)!==generation)return null;
    const depth=Atomics.load(control,base+LANE_DEPTH),score=Atomics.load(control,base+LANE_SCORE),nodes=Atomics.load(control,base+LANE_NODES);
    const offset=laneByteOffset(lane,generation),bytes=new Uint8Array(pool.controlBuffer);
    const length=Math.max(0,Math.min(8,Atomics.load(control,base+LANE_MOVE_LEN)));
    let move='';for(let i=0;i<length;i++)move+=String.fromCharCode(bytes[offset+SMP_MOVE_OFFSET+i]);
    const resultGeneration=Atomics.load(control,base+LANE_RESULT_GEN),after=Atomics.load(control,seqWord);
    if(before===after&&!(after&1)&&resultGeneration===generation&&move)return {workerId,move,depth,score,nodes,scoreExact:true,scoreBound:'exact',startLatencyMicros:Atomics.load(control,base+LANE_START_LATENCY_US)};
  }
  return null;
}
async function runPersistentHelper(data){
  const {id,workerId,lane,controlBuffer,sharedTTBuffer,plan,v14Mode,baseVersion}=data;
  if(v14Mode!==true||baseVersion!==PET_BASE_VERSION)throw new Error('Persistent helper refused a mismatched pet-learning base checkpoint.');
  const [checkpoint]=await Promise.all([loadPetBaseModel(),loadDualModel()]);
  const brain=new self.CheloBrain(`chelo_smp_helper_${workerId}`,{plan,persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
  const control=new Int32Array(controlBuffer),bytes=new Uint8Array(controlBuffer),base=laneBase(lane);
  const decoder=new TextDecoder();
  self.postMessage({id,ok:true,ready:true,workerId});
  let generation=Atomics.load(control,base+LANE_GEN);
  // This worker remains parked in an atomic generation wait between searches.
  // No per-position postMessage is used; the parent publishes each request in SAB.
  for(;;){
    Atomics.wait(control,base+LANE_GEN,generation);
    const next=Atomics.load(control,base+LANE_GEN);
    if(next===generation)continue;
    generation=next;
    const offset=laneByteOffset(lane,generation);
    const wakeUs=Math.round(((performance.timeOrigin||0)+performance.now())*1000),publishedUs=Atomics.load(control,base+LANE_START_PUBLISH_US);
    Atomics.store(control,base+LANE_START_LATENCY_US,Math.max(0,wakeUs-publishedUs));
    try{
      const fenLength=Atomics.load(control,base+LANE_FEN_LEN);
      const petDataLength=Atomics.load(control,base+LANE_PET_DATA_LEN);
      let fen='';for(let i=0;i<fenLength;i++)fen+=String.fromCharCode(bytes[offset+i]);
      if(petDataLength>0){
        const petData=JSON.parse(decoder.decode(bytes.subarray(offset+SMP_PET_DATA_OFFSET,offset+SMP_PET_DATA_OFFSET+petDataLength)));
        if(petData?.v===16)brain.importCompactData(petData);
      }
      const chess=new self.ChessCore(fen);
      const maxNodes=Atomics.load(control,base+LANE_MAX_NODES),maxTimeMs=Atomics.load(control,base+LANE_TIME_MS);
      const maxDepth=Atomics.load(control,base+LANE_MAX_DEPTH),startDepth=Atomics.load(control,base+LANE_START_DEPTH);
      const result=brain.chooseMove(chess,{mode:'apex',bookBinary:null,maxNodes,maxTimeMs,maxDepth,startDepth,workerId,aspiration:true,aspirationWindow:64,rootPvs:true,usePolicy:false,useHistory:true,sharedTTBuffer,sharedStopBuffer:controlBuffer,sharedStopIndex:base+LANE_STOP,sharedStopExpected:generation,sharedStopSignalIndex:-1,sharedStopLatencyIndex:-1,__onIterationComplete:(move,depth,score,nodes)=>{
        if(Atomics.load(control,base+LANE_GEN)!==generation)return;
        let seq=Atomics.load(control,base+LANE_RESULT_SEQ);if(seq&1)seq++;
        Atomics.store(control,base+LANE_RESULT_SEQ,(seq+1)|0);
        Atomics.store(control,base+LANE_DEPTH,depth);Atomics.store(control,base+LANE_SCORE,score);Atomics.store(control,base+LANE_NODES,nodes);
        Atomics.store(control,base+LANE_MOVE_LEN,Math.min(8,move.length));
        for(let i=0;i<move.length&&i<8;i++)bytes[offset+SMP_MOVE_OFFSET+i]=move.charCodeAt(i)&255;
        Atomics.store(control,base+LANE_RESULT_GEN,generation);
        Atomics.store(control,base+LANE_RESULT_SEQ,(seq+2)|0);
      }});
      if(Atomics.load(control,base+LANE_GEN)===generation){
        Atomics.store(control,base+LANE_DONE_GEN,generation);
        Atomics.store(control,base+LANE_STATE,SMP_DONE);
      }
    }catch(error){
      if(Atomics.load(control,base+LANE_GEN)===generation){Atomics.store(control,base+LANE_ERROR,1);Atomics.store(control,base+LANE_STATE,SMP_ERROR);}
    }
    Atomics.add(control,SMP_DONE_COUNT,1);
    Atomics.notify(control,SMP_DONE_COUNT);
  }
}
self.addEventListener('message', async event => {
  const data=event.data||{};
  if(data.workerRole==='smp-persistent-helper'){
    try{await runPersistentHelper(data);}catch(error){self.postMessage({id:data.id,ok:false,ready:false,error:error?.message||'Apex helper startup failed.'});}
    return;
  }
  try{await handleSearch(data);}catch(error){self.postMessage({id:data.id,ok:false,error:error?.message||'Chelo could not finish its search.'});}
});
async function handleSearch(data){
  const {id,fen,brainData,plan,timeMs,nodeLimit,maxTimeMs,maxNodes,v14Mode,baseVersion,mode='rated'}=data;
  try{
    if(v14Mode!==true||baseVersion!==PET_BASE_VERSION)throw new Error('Worker refused a non-compatible pet-learning base request.');
    const [checkpoint,bookBinary]=await Promise.all([loadPetBaseModel(),loadBook(),loadDualModel()]);
    const chess=new self.ChessCore(fen);
    const fairnessMode=['rated','pvp','companion'].includes(mode); // 'adaptive' is local companion play with a trainer-calibrated search budget.
    const fixedNodeBudget=30000;
    const canSmp=!fairnessMode&&mode==='apex'&&self.crossOriginIsolated===true&&typeof SharedArrayBuffer!=='undefined'&&typeof Worker!=='undefined';
    const brain=new self.CheloBrain('chelo_worker',{data:brainData,plan,persist:false,v14Mode:true,baseModel:checkpoint.tensors,baseVersion:checkpoint.baseVersion});
    // Enforce the hatchling gate inside the worker too. The app marks this as
    // passed only after it has already chosen the developmental route.
    if(mode==='adaptive'&&data.developmentalGatePassed!==true){
      const developmental=brain.chooseAdaptiveMove(chess);
      if(developmental?.move){self.postMessage({id,ok:true,engine:'developmental-companion',model:'piece-movement-to-learned-search',...developmental});return;}
    }
    // Retained one-shot diagnostic helper entry point for existing test harnesses;
    // production Apex orchestration exclusively uses the persistent SAB loop.
    if(data.workerRole==='apex-helper'){
      const helperResult=brain.chooseMove(chess,{maxTimeMs:maxTimeMs??timeMs,maxNodes:maxNodes??nodeLimit,maxDepth:Math.max(1,Math.min(80,Number(data.maxDepth)||10)),startDepth:1+(Number(data.workerId||0)&1),aspiration:true,aspirationWindow:64,rootPvs:true,usePolicy:false,useHistory:true,bookBinary:null,sharedTTBuffer:data.sharedTTBuffer,workerId:Number(data.workerId)||0});
      self.postMessage({id,ok:true,helper:true,workerId:data.workerId||0,...helperResult});return;
    }
    // Keep the verified Polyglot opening book in front of the C++ search.
    // Only a legal, hash-matched book move is accepted; after the book, all
    // adaptive tree search runs through C++/V37 and the pet adapters.
    if(mode==='adaptive'&&bookBinary&&brain.adaptiveSearchProfile().openingBookAllowed){
      const legal=chess.moves({verbose:true,skipSan:true});
      const bookMove=self.CheloPolyglotBookLookup(bookBinary,self.CheloPolyglotHash(chess),legal);
      if(bookMove){self.postMessage({id,ok:true,move:bookMove,depth:0,nodes:0,score:null,book:true,bookLookup:'polyglot-binary-search',cppEngine:false,engine:'polyglot-book',engineFallback:false,model:'chelo-v15-cpp-v37-dual-nnue'});return;}
    }
    let cppFailureReason='';
    const wantsCpp=data.useCppEngine===true||mode==='adaptive';
    if(wantsCpp&&!fairnessMode&&data.workerRole!=='apex-helper'){
      try{
        const cppResult=await tryCppSearch(chess,brain,Math.max(10,Number(maxTimeMs??timeMs)||250),Math.max(1,Math.min(32,Number(data.maxDepth)||12)),mode==='adaptive'?(maxNodes??nodeLimit):0);
        self.postMessage({id,ok:true,model:'chelo-v15-cpp-v37-dual-nnue',fairnessMode:mode,engineFallback:false,...cppResult});return;
      }catch(cppError){
        cppFailureReason=String(cppError?.message||cppError||'C++ WASM engine unavailable');
        console.warn('Chelo C++ engine unavailable; using the JavaScript safety fallback:',cppError);
      }
    }
    if(fairnessMode){
      const result=brain.chooseMove(chess,{maxNodes:fixedNodeBudget,deterministicNodes:true,aspiration:true,bookBinary:null});
      self.postMessage({id,ok:true,model:'v15-dual-perspective-32-screlu+bond-arena-lora',fairnessMode:mode,...result});return;
    }
    if(mode!=='apex'){
      const result=brain.chooseMove(chess,{timeMs:timeMs??maxTimeMs,nodeLimit:nodeLimit??maxNodes,maxTimeMs:maxTimeMs??timeMs,maxNodes:maxNodes??nodeLimit,maxDepth:data.maxDepth,bookBinary});
      self.postMessage({id,ok:true,model:'v15-dual-perspective-32-screlu+bond-arena-lora',fairnessMode:mode,engine:'javascript-fallback',engineFallback:!!cppFailureReason,engineFallbackReason:cppFailureReason||undefined,...result});return;
    }
    if(canSmp){
      const requested=Math.min(SMP_MAX_WORKERS,Math.max(1,Number(data.apexThreads)||((typeof navigator!=='undefined'&&navigator.hardwareConcurrency)||2)));
      if(!apexPool||apexPool.workerCount!==requested)apexPool=await createApexPool(requested,plan);
    }
    const pool=canSmp?apexPool:null;
    const timeBudget=Math.max(10,Math.floor(Number(maxTimeMs??timeMs)||40));
    const nodeBudget=Math.max(1,Math.floor(Number(maxNodes??nodeLimit)||10000000));
    const maxDepth=Math.max(1,Math.min(80,Math.floor(Number(data.maxDepth)||10)));
    const searchOptions={maxTimeMs:timeBudget,maxNodes:nodeBudget,maxDepth,aspiration:true,rootPvs:true,usePolicy:false,useHistory:true,bookBinary:null,workerId:0};
    let result;
    if(pool&&pool.helpers.length){
      const encoder=new TextEncoder(),petDataBytes=encoder.encode(JSON.stringify(brainData||{}));
      if(petDataBytes.length>SMP_PET_DATA_CAP)throw new Error(`Apex pet snapshot exceeds the ${SMP_PET_DATA_CAP}-byte shared command capacity.`);
      Atomics.store(pool.control,SMP_DONE_COUNT,0);
      for(let workerId=1;workerId<pool.workerCount;workerId++)writeHelperCommand(pool,workerId,fen,petDataBytes,{maxNodes:nodeBudget,maxTimeMs:timeBudget,maxDepth});
      searchOptions.sharedTTBuffer=pool.sharedTTBuffer;
      const mainResult=brain.chooseMove(chess,searchOptions);
      // Stop every helper by changing its job-local token. Do not wait for a
      // completion barrier: consume only the last atomically published exact
      // iteration snapshots already available at this instant.
      const candidates=[];
      let finished=0;
      for(let workerId=1;workerId<pool.workerCount;workerId++){
        const base=laneBase(workerId-1),generation=Atomics.load(pool.control,base+LANE_GEN);
        Atomics.store(pool.control,base+LANE_STOP,(generation+1)|0);
        if(Atomics.load(pool.control,base+LANE_DONE_GEN)===generation)finished++;
      }
      for(let workerId=1;workerId<pool.workerCount;workerId++){
        const helperResult=readHelperResult(pool,workerId);if(helperResult)candidates.push(helperResult);
      }
      const adopted=scoreSearchResults(mainResult,candidates);
      result={...mainResult,move:adopted.move,depth:adopted.depth,score:adopted.score,scoreExact:adopted.scoreExact===true,scoreBound:adopted.scoreBound||mainResult.scoreBound,adoptedWorkerId:adopted.workerId,smpWorkers:pool.workerCount,helperFinishedCount:finished,sharedTranspositionTable:true,nonBlockingHelperStop:true,helperResults:[{workerId:0,move:mainResult.move,depth:mainResult.depth,score:mainResult.score,scoreExact:mainResult.scoreExact===true},...candidates.map(x=>({workerId:x.workerId,move:x.move,depth:x.depth,score:x.score,scoreExact:x.scoreExact,nodes:x.nodes||0,startLatencyMicros:x.startLatencyMicros||0}))],smpAverageStartLatencyMicros:candidates.length?Math.round(candidates.reduce((n,x)=>n+(x.startLatencyMicros||0),0)/candidates.length):0,smpMaxStartLatencyMicros:Math.max(0,...candidates.map(x=>x.startLatencyMicros||0)),smpStartMode:'atomics-generation-loop'};
    }else{
      result=brain.chooseMove(chess,searchOptions);
      if(mode==='apex')Object.assign(result,{smpWorkers:1,sharedTranspositionTable:false,smpFallbackReason:'cross-origin isolation, SharedArrayBuffer, or Worker support unavailable'});
    }
    self.postMessage({id,ok:true,model:'v15-dual-perspective-32-screlu+bond-arena-lora',fairnessMode:mode,...result});
  }catch(error){self.postMessage({id,ok:false,error:error?.message||'Chelo could not finish its search.'});}
}
