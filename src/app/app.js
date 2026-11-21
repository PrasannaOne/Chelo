(() => {
  'use strict';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const chess = new ChessCore();
  const entitlement = window.CHELO_ENTITLEMENT || window.CHESSLING_ENTITLEMENT;
  const verifiedPlan = entitlement?.verified === true && entitlement.plan === 'pro' ? 'pro' : 'free';
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const PET_STORAGE_KEY = 'chelo_pet_1';
  const LEGACY_PET_STORAGE_KEY = 'chessling_pet_1';
  const ACTIVE_MATCH_KEY = 'chelo_active_match_v4';
  const LEGACY_MATCH_KEYS = ['chessling_active_match_v3','chessling_active_match_v2'];
  const API_BASE_KEY = 'chelo_api_base';
  const TOKEN_KEY = 'chelo_access_token';
  const ETAG_KEY = 'chelo_cloud_etag';
  const BASE_MODEL_URL = './models/base-v14-float32.json';
  const DUAL_MODEL_URL = './models/dual-nnue-v37.bin';
  const BOOK_URL = './models/polyglot-book.bin';
  const DUAL_MODEL_SHA256 = 'f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e';
  const PET_BASE_VERSION = 'v13-f32-policy-2026-11-19-seed-20261119';
  let brain = null, cheloStore = null, cheloPets = [], activePetId = 'pet-1';
  let cheloPlayer = {id:'local-player',handle:'',displayName:'',settings:{},createdAt:Date.now(),activePetId:'pet-1',activeMatch:null};
  let openingBookBinary = null, aiWorker = null, aiRequest = 0;
  let mode = 'human', selected = null, selectedMoves = [], flipped = false;
  let busy = false, finished = false, lastMove = null, pendingPromotion = null;
  const toast = message => {
    const el=$('toast'); if(!el)return;
    el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove('show'),2800);
  };

  async function loadPetBaseModel(){
    const response=await fetch(BASE_MODEL_URL,{cache:'no-cache'});
    if(!response.ok)throw new Error(`Chelo pet-learning base model unavailable (${response.status}).`);
    const checkpoint=await response.json();
    if(checkpoint?.version!==14||checkpoint?.baseVersion!==PET_BASE_VERSION||!checkpoint?.tensors)throw new Error('The Chelo pet-learning base model identity is invalid.');
    return checkpoint;
  }
  async function loadDualModel(){
    if(!window.CheloDualNNUE)throw new Error('Chelo dual-NNUE parser is unavailable.');
    const response=await fetch(DUAL_MODEL_URL,{cache:'no-cache'});
    if(!response.ok)throw new Error(`Chelo dual-NNUE model unavailable (${response.status}).`);
    const buffer=await response.arrayBuffer();
    if(!globalThis.crypto?.subtle)throw new Error('Secure SHA-256 verification is unavailable in this browser.');
    const digest=await globalThis.crypto.subtle.digest('SHA-256',buffer);
    const hex=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    if(hex!==DUAL_MODEL_SHA256)throw new Error('Chelo dual-NNUE SHA-256 mismatch.');
    window.CheloDualNNUE.model=window.CheloDualNNUE.parse(buffer);return window.CheloDualNNUE.model;
  }
  async function loadOpeningBook(){
    try{const response=await fetch(BOOK_URL);if(!response.ok)return null;const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==20480||bytes.length%16)return null;openingBookBinary=bytes;return bytes;}catch{return null;}
  }
  function readLegacyPetData(){
    for(const key of [PET_STORAGE_KEY,LEGACY_PET_STORAGE_KEY])try{const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);if(value&&typeof value==='object')return value;}}catch(error){console.warn('Chelo ignored an unreadable old pet save.',error);}
    return null;
  }
  function readLegacyMatch(){
    for(const key of [ACTIVE_MATCH_KEY,...LEGACY_MATCH_KEYS])try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&Array.isArray(value.moves))return value;}catch{}
    return null;
  }
  function createBrain(compact){
    return new CheloBrain('chelo_runtime',{data:compact||{},plan:verifiedPlan,persist:false,v14Mode:true,baseModel:window.__CHELO_BASE_MODEL.tensors,baseVersion:window.__CHELO_BASE_MODEL.baseVersion,onSave:savePetRecord});
  }
  function savePetRecord(compact){
    const index=cheloPets.findIndex(item=>item.id===activePetId),entry={id:activePetId,data:compact};
    if(index<0)cheloPets.push(entry);else cheloPets[index]=entry;
    if(!cheloStore)return Promise.resolve(false);
    return cheloStore.savePet(activePetId,compact).catch(error=>{console.error('Chelo pet save failed.',error);return false;});
  }
  function savePlayerRecord(){return cheloStore?cheloStore.savePlayer(cheloPlayer).catch(error=>{console.error('Chelo player save failed.',error);return false;}):Promise.resolve(false);}

  function createAIWorker(){
    if(!('Worker'in window))return;
    try{aiWorker=new Worker(new URL('./src/worker/ai-worker.js', document.baseURI),{name:'chelo-search'});}catch(error){console.warn('Chelo will use its local fallback search.',error);}
  }
  function requestAIMove(){
    const profile=brain.adaptiveSearchProfile(),bookBinaryForLevel=profile.challengeRating>=800?openingBookBinary:null;
    if(!aiWorker)return new Promise(resolve=>setTimeout(()=>{
      try{resolve({ok:true,...brain.chooseMove(chess,{maxNodes:profile.maxNodes,maxTimeMs:profile.maxTimeMs,maxDepth:profile.maxDepth,bookBinary:bookBinaryForLevel,usePolicy:false}),engine:'javascript-fallback',engineFallback:true,engineFallbackReason:'Web Worker is unavailable'});}
      catch(error){resolve({ok:false,error:error.message});}
    },20));
    return new Promise(resolve=>{
      const id=++aiRequest;let settled=false;
      const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);aiWorker?.removeEventListener('message',handler);aiWorker?.removeEventListener('error',errorHandler);resolve(result);};
      const handler=event=>{if(event.data?.id===id)finish(event.data);};
      const fallback=()=>{
        if(aiWorker){aiWorker.terminate();aiWorker=null;}
        try{const p=brain.adaptiveSearchProfile();finish({ok:true,...brain.chooseMove(chess,{maxNodes:p.maxNodes,maxTimeMs:p.maxTimeMs,maxDepth:p.maxDepth,bookBinary:p.challengeRating>=800?openingBookBinary:null,usePolicy:false}),engine:'javascript-fallback',engineFallback:true,engineFallbackReason:'Worker search did not respond'});}
        catch(error){finish({ok:false,error:error.message});}
      };
      const errorHandler=()=>fallback(),timer=setTimeout(fallback,6500);
      aiWorker.addEventListener('message',handler);aiWorker.addEventListener('error',errorHandler,{once:true});
      try{aiWorker.postMessage({id,fen:chess.fen(),brainData:brain.compactData(),plan:brain.plan,v14Mode:true,baseVersion:PET_BASE_VERSION,timeMs:profile.maxTimeMs,maxTimeMs:profile.maxTimeMs,nodeLimit:profile.maxNodes,maxNodes:profile.maxNodes,maxDepth:profile.maxDepth,mode:'adaptive',useCppEngine:true});}
      catch{fallback();}
    });
  }

  const packMatchMoves=moves=>window.CheloSave.packMoves(moves);
  const unpackMatchMoves=match=>Array.isArray(match?.moves)?match.moves:window.CheloSave.unpackMoves(match?.movesPacked);
  function getActiveMatch(){return cheloPlayer.activeMatch&&unpackMatchMoves(cheloPlayer.activeMatch)?cheloPlayer.activeMatch:readLegacyMatch();}
  function saveActiveMatch(){
    cheloPlayer.activePetId=activePetId;
    cheloPlayer.activeMatch={version:4,mode,movesPacked:packMatchMoves(chess.historyMoves().map(m=>m.uci)),updatedAt:Date.now()};
    savePlayerRecord();
    try{localStorage.removeItem(ACTIVE_MATCH_KEY);for(const key of LEGACY_MATCH_KEYS)localStorage.removeItem(key);}catch{}
  }
  function clearActiveMatch(){cheloPlayer.activeMatch=null;savePlayerRecord();try{localStorage.removeItem(ACTIVE_MATCH_KEY);for(const key of LEGACY_MATCH_KEYS)localStorage.removeItem(key);}catch{}}
  function restoreMatch(match){
    chess.load(START_FEN);if(match?.mode==='practice')return false;
    const moves=unpackMatchMoves(match);if(!match||!moves)return false;
    for(const uci of moves)if(!chess.move(uci)){chess.load(START_FEN);return false;}
    mode='human';lastMove=chess.historyMoves().at(-1)||null;return true;
  }
  function updateSideLabels(){
    $('whiteName').textContent='You';$('blackName').textContent=brain.data.petName;
    $('whiteMode').textContent='· White';$('blackMode').textContent='· Black';
  }
  function renderBoard(){
    const el=$('chessboard');el.innerHTML='';const board=chess.board();
    for(let displayRow=0;displayRow<8;displayRow++)for(let displayCol=0;displayCol<8;displayCol++){
      const row=flipped?7-displayRow:displayRow,col=flipped?7-displayCol:displayCol,rank=8-row,file='abcdefgh'[col],square=file+rank,piece=board[row][col];
      const cell=document.createElement('button');cell.type='button';cell.className=`square ${(row+col)%2===0?'light':'dark'}`;cell.setAttribute('role','gridcell');cell.setAttribute('aria-label',`${square}${piece?' '+piece.color+' '+piece.type:' empty'}`);cell.dataset.square=square;
      if(selected===square)cell.classList.add('selected');if(lastMove&&(lastMove.from===square||lastMove.to===square))cell.classList.add('last-move');
      const isTarget=selectedMoves.some(move=>move.to===square);if(isTarget){const dot=document.createElement('span');dot.className='move-dot';cell.appendChild(dot);if(piece)cell.classList.add('has-piece');}
      if(piece){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('class','piece-svg');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',`./assets/pieces.svg#${piece.color}${piece.type}`);svg.appendChild(use);cell.appendChild(svg);}
      if(displayCol===0){const coord=document.createElement('span');coord.className='coordinate rank';coord.textContent=rank;cell.appendChild(coord);}
      if(displayRow===7){const coord=document.createElement('span');coord.className='coordinate file';coord.textContent=file;cell.appendChild(coord);}
      cell.addEventListener('click',()=>onSquareTap(square));el.appendChild(cell);
    }
  }
  function onSquareTap(square){
    if(mode!=='human'||busy||finished||chess.turn()!=='w')return;
    const targets=selectedMoves.filter(move=>move.to===square);
    if(selected&&targets.length){if(targets.some(move=>move.promotion)){pendingPromotion={from:selected,to:square};$('promotionDialog').showModal();return;}playHuman(selected,square);return;}
    const piece=chess.get(square);if(piece&&piece.color==='w'){selected=square;selectedMoves=chess.moves({square,verbose:true});}else{selected=null;selectedMoves=[];}renderBoard();
  }
  function playHuman(from,to,promotion='q'){
    const fenBefore=chess.fen(),move=chess.move({from,to,promotion});if(!move)return;
    brain.observeHumanMove(fenBefore,move.uci,chess.historyMoves().length);brain.resolveLastPetMove(chess);
    lastMove=move;selected=null;selectedMoves=[];saveActiveMatch();renderBoard();updateBrainUI();updateClaimButton();
    if(checkGameEnd())return;
    busy=true;$('thinkingLabel').textContent='CHELO IS THINKING';$('turnState').textContent='Thinking…';$('gameMessage').textContent='Chelo is considering its reply.';makePetMove();
  }
  async function makePetMove(){
    if(finished||mode!=='human')return;
    const search=await requestAIMove();if(finished||mode!=='human')return;
    if(!search?.ok||!search.move){busy=false;$('gameMessage').textContent=search?.error||'Chelo could not find a legal move.';$('thinkingLabel').textContent='YOUR MOVE';$('turnState').textContent='Your turn';toast('Chelo could not complete its move.');return;}
    const fenBefore=chess.fen(),move=chess.move(search.move);
    if(!move){busy=false;$('gameMessage').textContent='The search returned an invalid move. The board was not changed.';toast('Chelo returned an invalid move.');return;}
    brain.observePetMove(fenBefore,move.uci,{piece:move.piece,captured:move.captured,gaveCheck:/[+#]$/.test(move.san),side:'b'},chess.historyMoves().length,chess);
    lastMove=move;busy=false;saveActiveMatch();renderBoard();updateBrainUI();updateClaimButton();
    if(!checkGameEnd()){$('thinkingLabel').textContent='YOUR MOVE';$('turnState').textContent='Your turn';$('gameMessage').textContent='Your move.';}
  }

  function updateClaimButton(){const button=$('claimDrawBtn');if(button)button.hidden=finished||!chess.canClaimDraw();}
  function endReason(){
    if(chess.inCheckmate())return 'Checkmate';
    if(chess.inStalemate())return 'Stalemate';
    if(chess.insufficient())return 'Insufficient material';
    if(chess.s?.half>=150)return '75-move rule';
    if(chess.positions?.filter(key=>key===chess.positionKey()).length>=5)return 'Fivefold repetition';
    return 'The game ended';
  }
  function finishMatch(outcome,reason){
    if(finished)return;
    finished=true;busy=false;mode='human';
    const result=brain.reinforce(outcome,chess),petName=brain.data.petName;
    clearActiveMatch();
    $('thinkingLabel').textContent='MATCH COMPLETE';$('turnState').textContent=outcome==='win'?`${petName} won`:outcome==='loss'?'You won':'Draw';$('gameMessage').textContent=`Match complete: ${$('turnState').textContent}. ${reason}.`;
    $('learningState').textContent=result.updatedPositions?'Bond adapted':'Memory recorded';updateClaimButton();
    const trainingLine=result.updatedPositions
      ?`Bond adapted in ${result.updatedPositions} of ${result.updatedPositions+result.skippedPositions} pet decision positions, changing ${result.updatedCoefficients} engine-used coefficients.`
      :`No Bond coefficients needed changing in this match. Chelo still saved the match memory and result.`;
    const challenge=result.challenge?` Personal challenge: ${result.challenge.previous} → ${result.challenge.current}.` : '';
    $('resultIcon').textContent=outcome==='win'?'♛':outcome==='loss'?'♙':'♟';
    $('resultTitle').textContent=outcome==='win'?`${petName} won`:outcome==='loss'?'You won':'Draw';
    $('resultReason').textContent=reason;
    $('resultLearning').textContent=`${result.memory||'Match memory saved.'} ${trainingLine}${challenge}`;
    updatePetUI();updateBrainUI();
    const dialog=$('matchResultDialog');if(!dialog.open)dialog.showModal();
  }
  function checkGameEnd(){
    if(!chess.game_over())return false;
    const result=chess.result(),outcome=result==='b'?'win':result==='w'?'loss':'draw';
    finishMatch(outcome,endReason());return true;
  }
  function updateMoveList(){
    const moves=chess.historyMoves(),list=$('moveList');if(!list)return;list.innerHTML='';
    if(!moves.length){list.innerHTML='<li class="empty-moves">No moves yet.</li>';$('moveCount').textContent='0';return;}
    for(let i=0;i<moves.length;i+=2){const li=document.createElement('li'),number=document.createElement('span'),white=document.createElement('span'),black=document.createElement('span');number.className='move-no';number.textContent=`${Math.floor(i/2)+1}.`;white.className='white-move';white.textContent=moves[i]?.san||'';black.className='black-move';black.textContent=moves[i+1]?.san||'';li.append(number,white,black);list.appendChild(li);}
    $('moveCount').textContent=String(moves.length);
  }
  function updatePetUI(){
    const data=brain.data;let avatar='🐣';if(data.gen>=2&&data.gen<4)avatar='🐥';else if(data.gen>=4&&data.gen<8)avatar='🦉';else if(data.gen>=8)avatar='🐉';
    $('petAvatar').textContent=avatar;$('petName').textContent=data.petName;$('petMood').textContent=brain.generation();$('drawerPersonality').textContent=brain.personality();
    $('growthValue').textContent=brain.growthLevel();$('masteryValue').textContent=brain.masteryTier();$('arenaRankValue').textContent='Unranked';$('recordValue').textContent=`${data.wins} · ${data.losses} · ${data.draws}`;
    $('challengeValue').textContent=`${data.elo||100} · Growing`; $('yourPetHandle').textContent=data.handle||'Not registered';updateSideLabels();
  }
  function updateBrainUI(){
    if(!brain)return;const data=brain.data,active={id:activePetId,data:brain.compactData()},pets=verifiedPlan==='pro'?cheloPets.filter(p=>p.id!==activePetId).concat([active]):[active];
    const doc={format:'CHELO',version:1,plan:verifiedPlan,player:cheloPlayer,pets},measure=window.CheloSave.measure(doc),limit=verifiedPlan==='pro'?window.CheloSave.constants.PRO_FILE_BYTES:window.CheloSave.constants.FREE_FILE_BYTES,size=measure.bytes;
    $('memoryCount').textContent=brain.memoryCount().toLocaleString();$('brainSize').innerHTML=`${(size/1024).toFixed(2)} KiB <small>/ ${(limit/1024).toFixed(0)} KiB</small>`;
    $('budgetFill').style.width=`${Math.min(100,size/limit*100)}%`;$('budgetFill').classList.toggle('near-limit',size>limit*.9);
    $('budgetLimitLabel').textContent=verifiedPlan==='pro'?`${measure.petBytes.length} pets · ${(size/1024).toFixed(1)} / ${(limit/1024).toFixed(0)} KiB`:`Complete .chelo · ${(size/1024).toFixed(1)} / 100 KiB`;
    $('modelUpdates').textContent=(data.dualLora?.bond?.steps||0).toLocaleString();
    const list=$('memoryList');list.innerHTML='';const memories=(data.memories||[]).slice(-8).reverse();
    if(!memories.length){list.innerHTML='<p class="empty-note">The first completed match will become its first memory.</p>';}
    for(const item of memories){const li=document.createElement('div'),dot=document.createElement('span'),copy=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');li.className='memory-item';dot.className='memory-dot';copy.className='memory-copy';strong.textContent=memoryText(item);small.textContent=`${item.plies||0} half-moves · ${item.tactical||0} tactical moments`;copy.append(strong,small);li.append(dot,copy);list.appendChild(li);}
    updateMoveList();
  }
  function memoryText(item){const labels={'battle-win':'Won a trainer match','tactical-win':'Won with tactical moments','battle-loss':'Turned a defeat into a lesson','tactical-lesson':'A tactical loss became a lesson','draw':'Drew the match','endurance-draw':'Held on through a long draw'};return labels[item.kind]||'Saved a chess memory';}
  function startNextMatch(){
    chess.load(START_FEN);brain.resetPending();clearActiveMatch();mode='human';selected=null;selectedMoves=[];lastMove=null;busy=false;finished=false;
    $('thinkingLabel').textContent='YOUR MOVE';$('turnState').textContent='Your turn';$('gameMessage').textContent='';
    saveActiveMatch();renderBoard();updateMoveList();updatePetUI();updateBrainUI();updateClaimButton();
  }

  function buildChelo(){
    cheloPlayer.activePetId=activePetId;cheloPlayer.activeMatch=finished?null:{version:4,mode,movesPacked:packMatchMoves(chess.historyMoves().map(m=>m.uci)),updatedAt:Date.now()};
    const active={id:activePetId,data:brain.compactData()},pets=verifiedPlan==='pro'?cheloPets.filter(item=>item.id!==activePetId).concat([active]):[active];
    return window.CheloSave.encode({plan:verifiedPlan,player:cheloPlayer,pets});
  }
  function exportChelo(){
    try{const output=buildChelo(),blob=new Blob([output.bytes],{type:'application/vnd.chelo+json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='player.chelo';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Player save exported · ${(output.bytes.byteLength/1024).toFixed(1)} KiB`);}
    catch(error){toast(error.message||'Could not export the .chelo player save.');}
  }
  async function importChelo(file){
    try{
      const save=window.CheloSave.decode(await file.arrayBuffer(),verifiedPlan);cheloPlayer=save.player;cheloPets=save.pets;
      activePetId=cheloPets.some(p=>p.id===cheloPlayer.activePetId)?cheloPlayer.activePetId:cheloPets[0].id;
      await cheloStore.replace(cheloPlayer,cheloPets);const active=cheloPets.find(p=>p.id===activePetId)||cheloPets[0];brain=createBrain(active.data);
      const restored=restoreMatch(cheloPlayer.activeMatch);finished=false;busy=false;if(!restored){brain.resetPending();chess.load(START_FEN);mode='human';}
      saveActiveMatch();renderBoard();updatePetUI();updateBrainUI();if(restored&&chess.turn()==='b'&&!chess.game_over()){busy=true;makePetMove();}else if(restored&&chess.game_over())checkGameEnd();
      toast(`Complete .chelo restored · ${cheloPets.length} pet${cheloPets.length===1?'':'s'}`);renderPetsPanel();
    }catch(error){toast(error.message||'Could not import this .chelo file.');}
  }

  function apiBase(){return String(localStorage.getItem(API_BASE_KEY)||window.CHELO_API_BASE||'').trim().replace(/\/+$/,'');}
  function authToken(){return String(localStorage.getItem(TOKEN_KEY)||'').trim();}
  async function apiFetch(route,options={}){
    const base=apiBase();if(!base)throw new Error('Add your Arena Worker URL in Save & Sync first.');
    return fetch(`${base}${route}`,{...options,headers:{...(options.headers||{}),...(authToken()?{Authorization:`Bearer ${authToken()}`}:{})}});
  }
  function openWorkspace(name){
    closeDrawer();$('overflowMenu').hidden=true;$('overflowBtn').setAttribute('aria-expanded','false');
    const names={leaderboard:'Leaderboard',pets:'My Pets',bond:'Bond & Memories',save:'Save & Sync',settings:'Settings',about:'About Chelo',technical:'Technical details',arena:'Arena',friends:'Friends Challenge'};
    $('workspaceTitle').textContent=names[name]||'Chelo';$('workspaceEyebrow').textContent=name==='arena'||name==='friends'?'CHALLENGES':'CHELO';
    document.querySelectorAll('[data-workspace]').forEach(panel=>panel.hidden=panel.dataset.workspace!==name);
    const dialog=$('workspaceDialog');if(!dialog.open)dialog.showModal();$('workspaceContent').scrollTop=0;
    if(name==='bond'){updatePetUI();updateBrainUI();}
    if(name==='pets')renderPetsPanel();
    if(name==='leaderboard')loadLeaderboard();
    if(name==='arena')loadArenaStatus();
    if(name==='save'){$('apiBaseInput').value=apiBase();$('accessTokenInput').value='';$('accessTokenInput').type='password';$('yourPetHandle').textContent=brain.data.handle||'Not registered';updateSyncStatus();}
    if(name==='friends')$('yourPetHandle').textContent=brain.data.handle||'Not registered';
  }
  function closeDrawer(){const drawer=$('sideDrawer'),scrim=$('drawerScrim'),btn=$('drawerOpen');drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');scrim.hidden=true;btn.setAttribute('aria-expanded','false');}
  function showDrawer(){const drawer=$('sideDrawer'),scrim=$('drawerScrim'),btn=$('drawerOpen');drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');scrim.hidden=false;btn.setAttribute('aria-expanded','true');}
  async function loadLeaderboard(){
    const state=$('leaderboardState'),list=$('leaderboardList');state.textContent='Loading verified standings…';list.innerHTML='';
    if(!apiBase()){state.textContent='Set the Arena Worker URL in Save & Sync to load global standings.';return;}
    try{const response=await fetch(`${apiBase()}/api/leaderboard`,{headers:{'Cache-Control':'no-cache'}});if(!response.ok)throw new Error(`Arena service returned ${response.status}.`);const data=await response.json();
      if(!data.results?.length){state.textContent='No verified ranked matches yet. Exhibitions do not award Arena points.';return;}
      state.textContent='Verified ranked standings';data.results.forEach((pet,index)=>{const li=document.createElement('li'),rank=document.createElement('span'),main=document.createElement('span'),name=document.createElement('strong'),sub=document.createElement('small'),points=document.createElement('span');li.className='leaderboard-row';rank.className='leaderboard-rank';rank.textContent=String(index+1);main.className='leaderboard-main';name.textContent=pet.display_name||pet.handle;sub.textContent=`@${pet.handle} · ${pet.wins||0}W ${pet.losses||0}L ${pet.draws||0}D`;points.className='leaderboard-points';points.textContent=String(pet.arena_points||0);main.append(name,sub);li.append(rank,main,points);list.appendChild(li);});
    }catch(error){state.textContent=apiBase()?`Leaderboard unavailable: ${error.message}`:'Set the Arena Worker URL in Save & Sync to load global standings.';}
  }
  async function loadArenaStatus(){
    const state=$('arenaServiceState');state.textContent='Checking Arena service…';
    if(!apiBase()){state.textContent='Set your Arena Worker URL in Save & Sync to connect the service.';return;}
    try{const response=await fetch(`${apiBase()}/api/health`,{headers:{'Cache-Control':'no-cache'}});if(!response.ok)throw new Error(`Service returned ${response.status}.`);const data=await response.json();state.textContent=`${data.service||'Arena API'} reachable · save format ${data.saveFormat||'CHELO'}. Ranked matchmaking remains locked until pet-move attestation is implemented.`;}
    catch(error){state.textContent=apiBase()?`Arena service unavailable: ${error.message}`:'Set your Arena Worker URL in Save & Sync to connect the service.';}
  }
  function updateSyncStatus(message){$('syncState').textContent=message||(!apiBase()?'Offline save is active. Connect your Arena Worker to enable account sync.':authToken()?'Worker configured. Your token is stored on this device.':'Worker configured. Create an account or add your access token to sync.');}
  function renderPetsPanel(){
    const list=$('petsList');list.innerHTML='';
    cheloPets.forEach(item=>{
      const temp=item.id===activePetId?brain:createBrain(item.data),data=temp.data,avatar=data.gen>=8?'🐉':data.gen>=4?'🦉':data.gen>=2?'🐥':'🐣';
      const row=document.createElement('div'),icon=document.createElement('span'),info=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('span');
      row.className='pet-row';icon.className='pet-avatar-small';icon.textContent=avatar;info.className='pet-info';name.textContent=data.petName;meta.textContent=`${temp.generation()} · ${temp.personality()}`;info.append(name,meta);actions.className='pet-actions';
      if(item.id===activePetId){const active=document.createElement('span');active.className='pet-active';active.textContent='ACTIVE';actions.append(active);}else{const select=document.createElement('button');select.type='button';select.textContent='Select';select.addEventListener('click',()=>switchPet(item.id));actions.append(select);}
      const rename=document.createElement('button');rename.type='button';rename.textContent='Rename';rename.addEventListener('click',()=>renamePet(item.id));actions.append(rename);row.append(icon,info,actions);list.appendChild(row);
    });
    const max=verifiedPlan==='pro'?5:1;$('petLimitNote').textContent=`${cheloPets.length} of ${max} pet slots used · ${verifiedPlan==='pro'?'Pro collection':'Free includes 1 pet'}`;$('createPetBtn').disabled=cheloPets.length>=max;
  }
  function renamePet(id){
    const item=cheloPets.find(p=>p.id===id);if(!item)return;const temp=id===activePetId?brain:createBrain(item.data),name=prompt('Give this Chelo a name:',temp.data.petName);
    if(!name||!name.trim())return;temp.data.petName=name.trim().slice(0,22);item.data=temp.compactData();if(id===activePetId){brain=temp;savePetRecord(brain.compactData());updatePetUI();updateBrainUI();}
    else cheloStore.savePet(id,item.data).catch(console.error);renderPetsPanel();toast('Pet name updated.');
  }
  async function switchPet(id){
    if(id===activePetId)return;
    if(chess.historyMoves().length&&!finished){toast('Finish the current match before switching pets.');return;}
    const item=cheloPets.find(p=>p.id===id);if(!item)return;
    if($('matchResultDialog').open)$('matchResultDialog').close();
    await savePetRecord(brain.compactData());activePetId=id;cheloPlayer.activePetId=id;brain=createBrain(item.data);chess.load(START_FEN);brain.resetPending();finished=false;busy=false;selected=null;selectedMoves=[];lastMove=null;clearActiveMatch();saveActiveMatch();renderBoard();updatePetUI();updateBrainUI();renderPetsPanel();toast(`${brain.data.petName} is ready.`);
  }
  async function adoptPet(){
    if(verifiedPlan!=='pro'){toast('The Free plan includes one pet. Pro unlocks five.');return;}
    if(cheloPets.length>=5){toast('Your five pet slots are full.');return;}
    if(chess.historyMoves().length&&!finished){toast('Finish the current match before adopting or switching pets.');return;}
    const name=prompt('Name your new Chelo:','Chelo '+(cheloPets.length+1));if(!name||!name.trim())return;
    let id=`pet-${crypto.randomUUID()}`,handle='';
    if(apiBase()&&authToken()){
      const requested=prompt('Choose a unique pet handle (3–20 letters, numbers or _):','chelo_'+Math.random().toString(36).slice(2,7));if(!requested)return;handle=requested.trim().toLowerCase();
      if(!/^[a-z0-9_]{3,20}$/.test(handle)){toast('That pet handle is not valid.');return;}
      try{const response=await apiFetch('/api/pets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({petHandle:handle,displayName:name.trim().slice(0,32)})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||`Service returned ${response.status}.`);id=payload.petId;}
      catch(error){toast(`Could not register pet: ${error.message}`);return;}
    }
    const petBrain=createBrain(null);petBrain.data.petName=name.trim().slice(0,22);petBrain.data.handle=handle;cheloPets.push({id,data:petBrain.compactData()});await cheloStore.savePet(id,petBrain.compactData());await switchPet(id);renderPetsPanel();
  }

  function showResultForToken(token){$('accessTokenInput').type='text';$('accessTokenInput').value=token;$('syncState').textContent='Account created. This access token is shown once. Copy it somewhere safe before leaving this page.';}
  async function createTrainerAccount(){
    const trainerHandle=$('trainerHandleInput').value.trim().toLowerCase(),petHandle=$('petHandleInput').value.trim().toLowerCase(),displayName=$('accountPetNameInput').value.trim()||brain.data.petName;
    if(chess.historyMoves().length&&!finished){toast('Finish the current match before creating an account.');return;}
    if(!apiBase()){toast('Save your Arena Worker URL first.');return;}
    if(!/^[a-z0-9_]{3,20}$/.test(trainerHandle)||!/^[a-z0-9_]{3,20}$/.test(petHandle)){toast('Handles must use 3–20 lowercase letters, numbers or underscores.');return;}
    try{const response=await fetch(`${apiBase()}/api/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trainerHandle,petHandle,displayName})});const data=await response.json();if(!response.ok)throw new Error(data.error||`Service returned ${response.status}.`);
      cheloPlayer={...cheloPlayer,id:data.trainerId,handle:data.trainerHandle,displayName:data.trainerHandle,activePetId:data.petId,activeMatch:null};activePetId=data.petId;brain.data.handle=data.petHandle;brain.data.petName=displayName.slice(0,22);brain.data.trainerName=data.trainerHandle;cheloPets=[{id:activePetId,data:brain.compactData()}];
      await cheloStore.replace(cheloPlayer,cheloPets);localStorage.setItem(TOKEN_KEY,data.accessToken);showResultForToken(data.accessToken);$('yourPetHandle').textContent='@'+data.petHandle;updatePetUI();updateBrainUI();toast('Trainer account created. Back up the access token now.');
    }catch(error){toast(`Account setup failed: ${error.message}`);}
  }
  function validateApiBase(){
    const value=$('apiBaseInput').value.trim();if(!value){localStorage.removeItem(API_BASE_KEY);updateSyncStatus();return;}
    try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||(url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname)))throw new Error();localStorage.setItem(API_BASE_KEY,url.origin);$('apiBaseInput').value=url.origin;updateSyncStatus('Arena Worker address saved.');toast('Service address saved.');}
    catch{toast('Enter a valid HTTPS Worker URL.');}
  }
  async function syncCloud(){
    try{const output=buildChelo(),headers={'Content-Type':'application/vnd.chelo+json'};const etag=localStorage.getItem(ETAG_KEY);if(etag)headers['If-Match']=etag;
      const response=await apiFetch('/api/player/save',{method:'PUT',headers,body:output.bytes});const data=await response.json();
      if(response.status===428){updateSyncStatus('A cloud save already exists. Restore it first to obtain its ETag, then merge before uploading.');throw new Error(data.error||'Read the cloud save first.');}
      if(response.status===409)throw new Error(data.error||'Cloud save conflict. Restore the latest version before retrying.');
      if(!response.ok)throw new Error(data.error||`Sync returned ${response.status}.`);
      const returned=response.headers.get('ETag');if(returned)localStorage.setItem(ETAG_KEY,returned);updateSyncStatus(`Synced successfully · revision ${data.revision} · ${(data.fileBytes/1024).toFixed(1)} KiB`);toast('Chelo cloud save synced.');
    }catch(error){if(!String($('syncState').textContent).includes('Restore it first'))updateSyncStatus(`Sync failed: ${error.message}`);toast(error.message);}
  }
  async function restoreCloud(){
    try{const response=await apiFetch('/api/player/save',{method:'GET',headers:{'Cache-Control':'no-cache'}});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`Restore returned ${response.status}.`);}
      const etag=response.headers.get('ETag');if(etag)localStorage.setItem(ETAG_KEY,etag);const file=new File([await response.arrayBuffer()],'cloud.chelo',{type:'application/vnd.chelo+json'});await importChelo(file);updateSyncStatus('Cloud save restored to this device.');
    }catch(error){updateSyncStatus(`Restore failed: ${error.message}`);toast(error.message);}
  }

  async function init(){
    try{
      cheloStore=new CheloLocalStore();
      const loaded=await Promise.all([loadPetBaseModel(),loadOpeningBook(),loadDualModel(),cheloStore.load()]);window.__CHELO_BASE_MODEL=loaded[0];
      const local=loaded[3];cheloPlayer=local.player||cheloPlayer;cheloPets=local.pets||[];
      if(!cheloPets.length)cheloPets=[{id:'pet-1',data:readLegacyPetData()||{}}];
      activePetId=cheloPets.some(p=>p.id===cheloPlayer.activePetId)?cheloPlayer.activePetId:cheloPets[0].id;cheloPlayer.activePetId=activePetId;
      brain=createBrain(cheloPets.find(p=>p.id===activePetId)?.data||{});brain.data.trainerName=cheloPlayer.displayName||cheloPlayer.handle||'';
      await cheloStore.replace(cheloPlayer,cheloPets);await savePetRecord(brain.compactData());
      try{localStorage.removeItem(PET_STORAGE_KEY);localStorage.removeItem(LEGACY_PET_STORAGE_KEY);}catch{}
    }catch(error){
      console.error('Chelo could not load its required pet-learning base model.',error);const message=document.createElement('p');message.className='game-message';message.textContent='Chelo could not load its offline brain. Refresh while connected once to install the model.';document.querySelector('.app-shell')?.prepend(message);return;
    }
    createAIWorker();const legacy=readLegacyMatch();if(!cheloPlayer.activeMatch&&legacy)cheloPlayer.activeMatch=legacy;const restored=restoreMatch(getActiveMatch());if(!restored&&brain.data.pending.length)brain.resetPending();
    renderBoard();updatePetUI();updateBrainUI();updateClaimButton();
    if(restored&&chess.historyMoves().length){$('gameMessage').textContent='Your unfinished match was restored.';if(chess.turn()==='b'&&!chess.game_over()){busy=true;$('thinkingLabel').textContent='CHELO IS THINKING';$('turnState').textContent='Thinking…';makePetMove();}else if(chess.game_over())checkGameEnd();}
    else saveActiveMatch();

    // Hamburger contains only pet personality and the two challenge destinations.
    $('drawerOpen').addEventListener('click',showDrawer);$('drawerClose').addEventListener('click',closeDrawer);$('drawerScrim').addEventListener('click',closeDrawer);
    document.querySelectorAll('[data-open-workspace]').forEach(button=>button.addEventListener('click',()=>openWorkspace(button.dataset.openWorkspace)));
    $('workspaceClose').addEventListener('click',()=>$('workspaceDialog').close());
    $('workspaceDialog').addEventListener('close',()=>$('workspaceContent').scrollTop=0);
    $('overflowBtn').addEventListener('click',()=>{const menu=$('overflowMenu');menu.hidden=!menu.hidden;$('overflowBtn').setAttribute('aria-expanded',String(!menu.hidden));});
    document.addEventListener('click',event=>{const menu=$('overflowMenu');if(!event.target.closest('.overflow-wrap')&&!menu.hidden){menu.hidden=true;$('overflowBtn').setAttribute('aria-expanded','false');}});
    $('shareBtn').addEventListener('click',async()=>{const data={title:'Chelo',text:'Meet Chelo, a little chess companion that learns as you play.',url:location.href};try{if(navigator.share)await navigator.share(data);else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(data.url);toast('Chelo link copied.');}else toast('Sharing is not available on this device.');}catch(error){if(error.name!=='AbortError')toast('Could not open sharing.');}});
    $('nextMatchBtn').addEventListener('click',()=>{$('matchResultDialog').close();startNextMatch();});
    $('claimDrawBtn').addEventListener('click',()=>{if(!chess.canClaimDraw()||finished||mode!=='human')return;const reason=chess.s?.half>=100?'50-move rule claimed':'Threefold repetition claimed';finishMatch('draw',reason);});
    $('flipBoardBtn').addEventListener('click',()=>{flipped=!flipped;renderBoard();toast('Board orientation changed.');});
    $('exportBtn').addEventListener('click',exportChelo);$('importBtn').addEventListener('click',()=>$('importFile').click());
    $('importFile').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importChelo(file);event.target.value='';});
    $('createPetBtn').addEventListener('click',adoptPet);$('saveApiBaseBtn').addEventListener('click',validateApiBase);$('createAccountBtn').addEventListener('click',createTrainerAccount);
    $('saveTokenBtn').addEventListener('click',()=>{const token=$('accessTokenInput').value.trim();if(!/^[a-f0-9]{64}$/i.test(token)){toast('That does not look like a valid 64-character access token.');return;}localStorage.setItem(TOKEN_KEY,token);toast('Access token saved on this device.');updateSyncStatus();});
    $('copyTokenBtn').addEventListener('click',async()=>{const token=$('accessTokenInput').value.trim();if(!token){toast('Create an account first to reveal its one-time token.');return;}try{await navigator.clipboard.writeText(token);toast('Access token copied. Store it somewhere safe.');}catch{$('accessTokenInput').focus();$('accessTokenInput').select();toast('Select and copy the token manually.');}});
    $('uploadCloudBtn').addEventListener('click',syncCloud);$('downloadCloudBtn').addEventListener('click',restoreCloud);
    $('openLeaderboardBtn').addEventListener('click',()=>openWorkspace('leaderboard'));$('openSaveFromFriendsBtn').addEventListener('click',()=>openWorkspace('save'));
    $('matchResultDialog').addEventListener('cancel',event=>event.preventDefault());
    let pointerStart=null;document.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')return;pointerStart={x:event.clientX,y:event.clientY};},{passive:true});
    document.addEventListener('pointerup',event=>{if(!pointerStart)return;const dx=event.clientX-pointerStart.x,dy=event.clientY-pointerStart.y;if(Math.abs(dx)>75&&Math.abs(dy)<90){if(dx>0&&pointerStart.x<26&&!$('workspaceDialog').open&&!$('matchResultDialog').open)showDrawer();else if(dx<0&&$('sideDrawer').classList.contains('open'))closeDrawer();}pointerStart=null;},{passive:true});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeDrawer();$('overflowMenu').hidden=true;$('overflowBtn').setAttribute('aria-expanded','false');}});
    $('promotionDialog').addEventListener('close',()=>{const choice=$('promotionDialog').returnValue;if(choice&&choice!=='cancel'&&pendingPromotion)playHuman(pendingPromotion.from,pendingPromotion.to,choice);pendingPromotion=null;});
    if(apiBase())updateSyncStatus();if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Offline installation is unavailable.',error));
  }
  window.addEventListener('DOMContentLoaded',init);
})();
