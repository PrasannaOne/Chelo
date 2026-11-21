(() => {
  'use strict';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const chess = new ChessCore();
  // This entitlement is supplied by the trusted account layer. A local file or
  // edited client state never grants Pro server storage; Cloudflare rechecks the
  // account plan before accepting a cloud .chelo upload.
  const entitlement = window.CHELO_ENTITLEMENT || window.CHESSLING_ENTITLEMENT;
  const verifiedPlan = entitlement?.verified === true ? entitlement.plan : 'free';
  let brain = null;
  let cheloStore = null;
  let cheloPlayer = {id:'local-player',handle:'',displayName:'',settings:{},createdAt:Date.now(),activePetId:'pet-1',activeMatch:null};
  let cheloPets = [];
  let activePetId = 'pet-1';
  let openingBookBinary = null;
  const BOOK_URL = './models/polyglot-book.bin';
  async function loadOpeningBook() {
    try { const response = await fetch(BOOK_URL); if (!response.ok) return null; const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length !== 20480 || bytes.length % 16) return null; openingBookBinary = bytes; return bytes; } catch { return null; }
  }
  const BASE_MODEL_URL = './models/base-v14-float32.json';
  const DUAL_MODEL_URL = './models/dual-nnue-v37.bin';
  const DUAL_MODEL_SHA256 = 'f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e';
  const PET_BASE_VERSION = 'v13-f32-policy-2026-11-19-seed-20261119';
  async function loadPetBaseModel() {
    const response = await fetch(BASE_MODEL_URL, {cache:'no-cache'});
    if (!response.ok) throw new Error(`Chelo pet-learning base model unavailable (${response.status}).`);
    const checkpoint = await response.json();
    if (checkpoint?.version !== 14 || checkpoint?.baseVersion !== PET_BASE_VERSION || !checkpoint?.tensors) throw new Error('The Chelo pet-learning base model identity is invalid.');
    return checkpoint;
  }
  async function loadDualModel() {
    if (!window.CheloDualNNUE) throw new Error('Chelo dual-NNUE parser is unavailable.');
    const response = await fetch(DUAL_MODEL_URL, {cache:'no-cache'});
    if (!response.ok) throw new Error(`Chelo dual-NNUE model unavailable (${response.status}).`);
    const buffer = await response.arrayBuffer();
    if (!globalThis.crypto?.subtle) throw new Error('Secure SHA-256 verification is unavailable in this browser.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    const hex = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (hex !== DUAL_MODEL_SHA256) throw new Error('Chelo dual-NNUE SHA-256 mismatch.');
    window.CheloDualNNUE.model = window.CheloDualNNUE.parse(buffer);
    return window.CheloDualNNUE.model;
  }
  const ACTIVE_MATCH_KEY = 'chelo_active_match_v4';
  const LEGACY_MATCH_KEYS = ['chessling_active_match_v3', 'chessling_active_match_v2'];
  const PET_STORAGE_KEY = 'chelo_pet_1';
  const LEGACY_PET_STORAGE_KEY = 'chessling_pet_1';
  function readLegacyPetData() {
    for (const key of [PET_STORAGE_KEY,LEGACY_PET_STORAGE_KEY]) {
      try { const raw=localStorage.getItem(key); if(raw){const value=JSON.parse(raw);if(value&&typeof value==='object')return value;} }
      catch(error){console.warn('Chelo ignored an unreadable legacy pet save.',error);}
    }
    return null;
  }
  function readLegacyMatch() {
    for (const key of [ACTIVE_MATCH_KEY,...LEGACY_MATCH_KEYS]) {
      try { const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&Array.isArray(value.moves))return value; }
      catch { /* Ignore an invalid old match snapshot. */ }
    }
    return null;
  }
  function savePetRecord(compact) {
    const index=cheloPets.findIndex(item=>item.id===activePetId),entry={id:activePetId,data:compact};
    if(index<0)cheloPets.push(entry);else cheloPets[index]=entry;
    if(!cheloStore)return Promise.resolve(false);
    return cheloStore.savePet(activePetId,compact).catch(error=>{console.error('Chelo pet save failed.',error);return false;});
  }
  function savePlayerRecord() {
    if(!cheloStore)return Promise.resolve(false);
    return cheloStore.savePlayer(cheloPlayer).catch(error=>{console.error('Chelo player save failed.',error);return false;});
  }
  function createBrain(compact) {
    return new CheloBrain('chelo_runtime',{data:compact||{},plan:verifiedPlan,persist:false,v14Mode:true,baseModel:window.__CHELO_BASE_MODEL.tensors,baseVersion:window.__CHELO_BASE_MODEL.baseVersion,onSave:savePetRecord});
  }
  let mode = 'human';
  let selected = null;
  let selectedMoves = [];
  let flipped = false;
  let busy = false;
  let finished = false;
  let lastMove = null;
  let pendingPromotion = null;
  let turnUndoSnapshot = null;
  let aiWorker = null;
  let aiRequest = 0;

  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const toast = message => {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  };

  function createAIWorker() {
    if (!('Worker' in window)) return;
    try { aiWorker = new Worker(new URL('./src/worker/ai-worker.js', document.baseURI), {name:'chelo-search'}); }
    catch (error) { console.warn('Chelo will use the local fallback search.', error); }
  }

  function requestAIMove() {
    const profile=brain.adaptiveSearchProfile();
    if (!aiWorker) return new Promise(resolve => setTimeout(() => {
      try { resolve({ok:true, ...brain.chooseMove(chess, {maxNodes:profile.maxNodes,maxTimeMs:profile.maxTimeMs,maxDepth:profile.maxDepth,bookBinary:openingBookBinary,usePolicy:false}),engine:'javascript-fallback',engineFallback:true,engineFallbackReason:'Web Worker is unavailable'}); }
      catch (error) { resolve({ok:false,error:error.message}); }
    }, 30));

    return new Promise(resolve => {
      const id = ++aiRequest;
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        aiWorker?.removeEventListener('message', handler);
        aiWorker?.removeEventListener('error', errorHandler);
        resolve(result);
      };
      const handler = event => { if (event.data?.id === id) finish(event.data); };
      const fallback = () => {
        if (aiWorker) { aiWorker.terminate(); aiWorker = null; }
        try { const profile=brain.adaptiveSearchProfile(); finish({ok:true, ...brain.chooseMove(chess, {maxNodes:profile.maxNodes,maxTimeMs:profile.maxTimeMs,maxDepth:profile.maxDepth,bookBinary:openingBookBinary,usePolicy:false}),engine:'javascript-fallback',engineFallback:true,engineFallbackReason:'Worker search did not respond'}); }
        catch (error) { finish({ok:false,error:error.message}); }
      };
      const errorHandler = () => fallback();
      const timer = setTimeout(fallback, 6000);
      aiWorker.addEventListener('message', handler);
      aiWorker.addEventListener('error', errorHandler, {once:true});
      try {
        aiWorker.postMessage({
          id, fen:chess.fen(), brainData:brain.compactData(), plan:brain.plan,
          v14Mode:true, baseVersion:PET_BASE_VERSION,
          timeMs:profile.maxTimeMs, maxTimeMs:profile.maxTimeMs, nodeLimit:profile.maxNodes, maxNodes:profile.maxNodes, maxDepth:profile.maxDepth, mode:'adaptive', useCppEngine:true
        });
      } catch { fallback(); }
    });
  }

  const packMatchMoves = moves => window.CheloSave.packMoves(moves);
  function unpackMatchMoves(match) {
    if(Array.isArray(match?.moves))return match.moves; // one-time migration from pre-M4 saves
    return window.CheloSave.unpackMoves(match?.movesPacked);
  }

  function getActiveMatch() {
    if(cheloPlayer.activeMatch&&unpackMatchMoves(cheloPlayer.activeMatch))return cheloPlayer.activeMatch;
    return readLegacyMatch();
  }

  function saveActiveMatch() {
    cheloPlayer.activePetId=activePetId;
    cheloPlayer.activeMatch={version:4,mode,movesPacked:packMatchMoves(chess.historyMoves().map(m=>m.uci)),updatedAt:Date.now()};
    savePlayerRecord();
    // Remove the separate legacy match records after copying into the unified save.
    try { localStorage.removeItem(ACTIVE_MATCH_KEY);for(const key of LEGACY_MATCH_KEYS)localStorage.removeItem(key); }
    catch(error){console.warn('Chelo could not remove an obsolete match snapshot.',error);}
  }

  function clearActiveMatch() {
    cheloPlayer.activeMatch=null;savePlayerRecord();
    try { localStorage.removeItem(ACTIVE_MATCH_KEY);for(const key of LEGACY_MATCH_KEYS)localStorage.removeItem(key); }
    catch { /* Storage may be disabled. */ }
  }

  function restoreMatch(match) {
    chess.load(START_FEN);
    if(match?.mode==='practice')return false; // Self-play has been retired; do not resume its legacy snapshots.
    const moves=unpackMatchMoves(match);
    if (!match || !moves) return false;
    for (const uci of moves) {
      if (!chess.move(uci)) { chess.load(START_FEN); return false; }
    }
    mode = 'human';
    lastMove = chess.historyMoves().at(-1) || null;
    return true;
  }

  function updateSideLabels() {
    const black = brain.data.petName;
    $('whiteName').textContent = 'You';
    $('blackName').textContent = black;
    $('whiteMode').textContent = '· White';
    $('blackMode').textContent = '· Black';
  }

  function renderBoard() {
    const el = $('chessboard');
    el.innerHTML = '';
    const board = chess.board();
    for (let displayRow=0;displayRow<8;displayRow++) {
      for (let displayCol=0;displayCol<8;displayCol++) {
        const row = flipped ? 7-displayRow : displayRow;
        const col = flipped ? 7-displayCol : displayCol;
        const rank = 8-row;
        const file = 'abcdefgh'[col];
        const square = file + rank;
        const piece = board[row][col];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `square ${(row+col)%2===0?'light':'dark'}`;
        cell.setAttribute('role','gridcell');
        cell.setAttribute('aria-label',`${square}${piece?' '+piece.color+' '+piece.type:' empty'}`);
        cell.dataset.square = square;
        if (selected === square) cell.classList.add('selected');
        if (lastMove && (lastMove.from === square || lastMove.to === square)) cell.classList.add('last-move');

        const isLegalTarget = selectedMoves.some(move => move.to === square);
        if (isLegalTarget) {
          const dot = document.createElement('span');
          dot.className = 'move-dot';
          cell.appendChild(dot);
          if (piece) cell.classList.add('has-piece');
        }
        if (piece) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
          svg.setAttribute('viewBox','0 0 100 100');
          svg.setAttribute('class','piece-svg');
          svg.setAttribute('aria-hidden','true');
          const use = document.createElementNS('http://www.w3.org/2000/svg','use');
          use.setAttribute('href',`pieces.svg#${piece.color}${piece.type}`);
          svg.appendChild(use);
          cell.appendChild(svg);
        }
        if (displayCol === 0) {
          const coord = document.createElement('span');
          coord.className = 'coordinate rank'; coord.textContent = rank; cell.appendChild(coord);
        }
        if (displayRow === 7) {
          const coord = document.createElement('span');
          coord.className = 'coordinate file'; coord.textContent = file; cell.appendChild(coord);
        }
        cell.addEventListener('click', () => onSquareTap(square));
        el.appendChild(cell);
      }
    }
  }

  function updateClaimButton() {
    $('claimDrawBtn').hidden = finished || !chess.canClaimDraw();
  }

  function onSquareTap(square) {
    if (mode !== 'human' || busy || finished || chess.turn() !== 'w') return;
    const target = selectedMoves.filter(move => move.to === square);
    if (selected && target.length) {
      if (target.some(move => move.promotion)) {
        pendingPromotion = {from:selected,to:square};
        $('promotionDialog').showModal();
        return;
      }
      playHuman(selected,square); return;
    }
    const piece = chess.get(square);
    if (piece && piece.color === 'w') {
      selected = square;
      selectedMoves = chess.moves({square,verbose:true});
    } else { selected = null; selectedMoves = []; }
    renderBoard();
  }

  function playHuman(from,to,promotion='q') {
    turnUndoSnapshot = {historyLength:chess.historyMoves().length,brainData:clone(brain.data)};
    const fenBefore = chess.fen();
    const move = chess.move({from,to,promotion});
    if (!move) { turnUndoSnapshot = null; return; }
    brain.observeHumanMove(fenBefore,move.uci,chess.historyMoves().length);
    brain.resolveLastPetMove(chess);
    lastMove = move;
    selected = null; selectedMoves = [];
    saveActiveMatch(); renderBoard(); updateMoveList(); updateBrainUI(); updateClaimButton();
    if (checkGameEnd()) return;
    busy = true;
    $('undoBtn').disabled = true;
    $('thinkingLabel').textContent = 'CHELO IS THINKING';
    $('turnState').textContent = 'Thinking…';
    $('learningState').textContent = 'Learning';
    $('gameMessage').textContent = 'It is weighing its options…';
    makePetMove();
  }

  async function makePetMove() {
    if (finished || mode !== 'human') return;
    const search = await requestAIMove();
    if (finished || mode !== 'human') return;
    if (!search?.ok || !search.move) {
      busy = false;
      $('gameMessage').textContent = search?.error || 'Chelo could not find a legal move.';
      $('thinkingLabel').textContent = 'YOUR MOVE'; $('turnState').textContent = 'Your turn';
      $('undoBtn').disabled = !turnUndoSnapshot; return;
    }
    const fenBefore = chess.fen();
    const move = chess.move(search.move);
    if (!move) {
      busy = false; $('gameMessage').textContent = 'The search returned an invalid move. The board was not changed.';
      $('undoBtn').disabled = !turnUndoSnapshot; return;
    }
    brain.observePetMove(fenBefore,move.uci,{
      piece:move.piece,captured:move.captured,gaveCheck:/[+#]$/.test(move.san),side:'b'
    },chess.historyMoves().length,chess);
    lastMove = move; busy = false; saveActiveMatch();
    renderBoard(); updateMoveList(); updateBrainUI(); updateClaimButton();
    $('undoBtn').disabled = !turnUndoSnapshot;
    if (!checkGameEnd()) {
      $('thinkingLabel').textContent = 'YOUR MOVE'; $('turnState').textContent = 'Your turn';
      $('learningState').textContent = 'Learning';
      $('gameMessage').textContent = `Chelo replied${search.depth?` · depth ${search.depth}`:''}${search.cppEngine?' · C++/V37':search.engineFallback?' · JS safety fallback':''}. Your turn.`;
    }
  }

  function finishMatch(outcome,message) {
    finished = true; busy = false; mode = 'human';
    brain.reinforce(outcome,chess); clearActiveMatch();
    $('thinkingLabel').textContent = 'MATCH COMPLETE';
    $('turnState').textContent = outcome==='win'?'Chelo wins':outcome==='loss'?'You win':'Draw';
    $('gameMessage').textContent = message;
    $('learningState').textContent = 'Memory saved';
    $('learningNote').textContent = outcome==='win'
      ? 'The completed game reinforced decisions that led to a win.'
      : outcome==='loss'
        ? 'The loss was reviewed. Its moves and their consequences remain part of its learning.'
        : 'The draw adds a smaller result signal. Individual move feedback still matters.';
    updatePetUI(); updateBrainUI(); updateClaimButton(); updateSideLabels();
    $('undoBtn').disabled = !turnUndoSnapshot;
  }

  function checkGameEnd() {
    if (!chess.game_over()) return false;
    const result = chess.result();
    let outcome='draw', message='A draw. Both sides keep the experience.';
    if (result==='b') { outcome='win'; message=`${brain.data.petName} wins. Your little monster found checkmate!`; }
    if (result==='w') { outcome='loss'; message=`You win! ${brain.data.petName} has a new lesson to remember.`; }
    finishMatch(outcome,message); return true;
  }

  function undoTurn() {
    if (busy || mode !== 'human' || !turnUndoSnapshot) return;
    while (chess.historyMoves().length > turnUndoSnapshot.historyLength) chess.undo();
    brain.data = clone(turnUndoSnapshot.brainData); brain.save();
    turnUndoSnapshot = null; finished = false; busy = false; selected = null; selectedMoves = [];
    lastMove = chess.historyMoves().at(-1) || null; saveActiveMatch();
    $('thinkingLabel').textContent='YOUR MOVE'; $('turnState').textContent='Your turn';
    $('learningState').textContent='Learning'; $('gameMessage').textContent='Last turn undone. Chelo’s saved learning was restored too.';
    $('undoBtn').disabled=true; renderBoard(); updateMoveList(); updatePetUI(); updateBrainUI(); updateClaimButton();
  }

  function updateMoveList() {
    const moves=chess.historyMoves(), list=$('moveList'); list.innerHTML='';
    if (!moves.length) {
      list.innerHTML='<li class="empty-moves">Your first move is waiting.</li>';
      $('moveCount').textContent='0 moves'; return;
    }
    for (let i=0;i<moves.length;i+=2) {
      const li=document.createElement('li');
      const number=document.createElement('span'); number.className='move-no'; number.textContent=`${Math.floor(i/2)+1}.`;
      const white=document.createElement('span'); white.className='white-move'; white.textContent=moves[i]?.san||'';
      const black=document.createElement('span'); black.className='black-move'; black.textContent=moves[i+1]?.san||'';
      li.append(number,white,black); list.appendChild(li);
    }
    $('moveCount').textContent=`${moves.length} half-moves`;
    list.scrollTop=list.scrollHeight;
  }

  function updatePetUI() {
    const data=brain.data;
    let avatar='🐣';
    if(data.gen>=2&&data.gen<4) avatar='🐥'; else if(data.gen>=4&&data.gen<8) avatar='🦉'; else if(data.gen>=8) avatar='🐉';
    $('petAvatar').textContent=avatar; $('petName').textContent=data.petName;
    $('petMood').textContent=`${brain.generation()} · ${brain.personality()}`;
    $('growthValue').textContent=brain.growthLevel();
    $('masteryValue').textContent=brain.masteryTier();
    $('arenaRankValue').textContent='Unranked';
    $('recordValue').textContent=`${data.wins} · ${data.losses} · ${data.draws}`;
    const challenge=$('challengeValue');if(challenge)challenge.textContent=`${data.elo||300} · Adaptive`; 
    updateSideLabels();
  }

  function updateBrainUI() {
    if(!brain)return;
    const data=brain.data;
    const activeData=brain.compactData();
    const active={id:activePetId,data:activeData};
    const pets=verifiedPlan==='pro'?cheloPets.filter(item=>item.id!==activePetId).concat([active]):[active];
    const saveDoc={format:'CHELO',version:1,plan:verifiedPlan,player:cheloPlayer,pets};
    const measure=window.CheloSave.measure(saveDoc);
    const limit=verifiedPlan==='pro'?window.CheloSave.constants.PRO_FILE_BYTES:window.CheloSave.constants.FREE_FILE_BYTES;
    const size=measure.bytes,activeBytes=measure.petBytes.at(-1)||0;
    $('memoryCount').textContent=brain.memoryCount().toLocaleString();
    $('brainSize').innerHTML=`${(size/1024).toFixed(2)} KiB <small>/ ${(limit/1024).toFixed(0)} KiB</small>`;
    $('budgetFill').style.width=`${Math.min(100,size/limit*100)}%`;
    $('budgetFill').classList.toggle('near-limit',size>limit*0.9);
    $('budgetLimitLabel').textContent=verifiedPlan==='pro'?`5 pets · ${(activeBytes/1024).toFixed(1)} / 500 KiB active pet`:`Complete .chelo · ${(size/1024).toFixed(1)} / 100 KiB`; 
    const memoryEcho=$('memoryEcho');if(memoryEcho)memoryEcho.textContent=brain.latestMemory()?`Recent memory · ${brain.latestMemory()}`:'No completed-game memories yet.';
    $('modelUpdates').textContent=(data.dualLora?.bond?.steps||0).toLocaleString();
    $('policyUpdates').textContent=(data.dualLora?.arena?.steps||0).toLocaleString();
    $('policySummary').textContent=`Bond updates · ${data.dualLora?.bond?.steps||0} · Arena updates · ${data.dualLora?.arena?.steps||0} · ${measure.petBytes.length} saved pet${measure.petBytes.length===1?'':'s'}`;
  }

  function contextLabel(model) {
    const episodes=Number(model?.episodes)||0;
    return `${episodes.toLocaleString()} training episodes`;
  }

  function newGame() {
    chess.load(START_FEN); brain.resetPending(); clearActiveMatch();
    mode='human'; turnUndoSnapshot=null; selected=null; selectedMoves=[]; lastMove=null;
    busy=false; finished=false;
    $('thinkingLabel').textContent='YOUR MOVE'; $('turnState').textContent='Your turn';
    $('learningState').textContent='Ready'; $('gameMessage').textContent='Choose a piece, then tap a highlighted square.';
    $('learningNote').textContent='Its first memories are being formed.'; $('undoBtn').disabled=true;
    saveActiveMatch(); renderBoard(); updateMoveList(); updateClaimButton(); updateSideLabels();
  }

  function exportChelo() {
    try {
      cheloPlayer.activePetId=activePetId;
      cheloPlayer.activeMatch={version:4,mode,movesPacked:packMatchMoves(chess.historyMoves().map(m=>m.uci)),updatedAt:Date.now()};
      const active={id:activePetId,data:brain.compactData()};
      const pets=verifiedPlan==='pro'?cheloPets.filter(item=>item.id!==activePetId).concat([active]):[active];
      const output=window.CheloSave.encode({plan:verifiedPlan,player:cheloPlayer,pets});
      const blob=new Blob([output.bytes],{type:'application/vnd.chelo+json'});
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='player.chelo';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`Player save exported · ${(output.bytes.byteLength/1024).toFixed(1)} KiB`);
    } catch(error) { toast(error.message||'Could not export the .chelo player save.'); }
  }

  async function importChelo(file) {
    try {
      const save=window.CheloSave.decode(await file.arrayBuffer(),verifiedPlan);
      cheloPlayer=save.player;cheloPets=save.pets;activePetId=cheloPets.some(pet=>pet.id===cheloPlayer.activePetId)?cheloPlayer.activePetId:cheloPets[0].id;
      await cheloStore.replace(cheloPlayer,cheloPets);
      const activePet=cheloPets.find(pet=>pet.id===activePetId)||cheloPets[0];
      brain=createBrain(activePet.data);
      const restored=restoreMatch(cheloPlayer.activeMatch);
      finished=false;busy=false;turnUndoSnapshot=null;
      if(!restored){brain.resetPending();chess.load(START_FEN);mode='human';finished=false;}
      saveActiveMatch();
      renderBoard();updateMoveList();updateClaimButton();updatePetUI();updateBrainUI();
      if(restored&&chess.turn()==='b'&&!chess.game_over()){busy=true;makePetMove();}
      else if(restored&&chess.game_over())checkGameEnd();
      toast(`Complete .chelo restored · ${cheloPets.length} pet${cheloPets.length===1?'':'s'}`);
    } catch(error) { toast(error.message||'Could not import this .chelo file.'); }
  }

  async function init() {
    try {
      cheloStore=new CheloLocalStore();
      const [checkpoint,localSave]=await Promise.all([loadPetBaseModel(),loadOpeningBook(),loadDualModel(),cheloStore.load()]).then(values=>[values[0],values[3]]);
      window.__CHELO_BASE_MODEL=checkpoint;
      cheloPlayer=localSave.player||cheloPlayer;
      cheloPets=localSave.pets||[];
      if(!cheloPets.length){
        const legacy=readLegacyPetData();
        cheloPets=[{id:'pet-1',data:legacy||{}}];
      }
      activePetId=cheloPets.some(pet=>pet.id===cheloPlayer.activePetId)?cheloPlayer.activePetId:(cheloPets[0]?.id||'pet-1');
      cheloPlayer.activePetId=activePetId;
      const activePet=cheloPets.find(pet=>pet.id===activePetId)||cheloPets[0];
      brain=createBrain(activePet?.data||{});
      brain.data.trainerName=cheloPlayer.displayName||cheloPlayer.handle||'';
      await cheloStore.replace(cheloPlayer,cheloPets.length?cheloPets:[{id:activePetId,data:brain.compactData()}]);
      if(!cheloPets.length)cheloPets=[{id:activePetId,data:brain.compactData()}];
      await savePetRecord(brain.compactData());
      // Delete the old independent localStorage saves only after IndexedDB migration succeeds.
      try{localStorage.removeItem(PET_STORAGE_KEY);localStorage.removeItem(LEGACY_PET_STORAGE_KEY);}catch{}
    } catch (error) {
      console.error('Chelo could not load its required pet-learning base model.', error);
      const message = document.createElement('p'); message.className = 'game-message';
      message.textContent = 'Chelo could not load its offline brain. Please refresh while connected once to install the model.';
      document.querySelector('.app-shell')?.prepend(message); return;
    }
    createAIWorker();
    const legacyMatch=readLegacyMatch();
    if(!cheloPlayer.activeMatch&&legacyMatch)cheloPlayer.activeMatch=legacyMatch;
    const activeMatch=getActiveMatch();
    const restored=restoreMatch(activeMatch);
    if(!restored&&brain.data.pending.length) brain.resetPending();
    renderBoard(); updatePetUI(); updateBrainUI(); updateMoveList(); updateClaimButton();
    if(restored&&chess.historyMoves().length) {
      $('gameMessage').textContent='Your unfinished match was restored.';
      if(mode==='human'&&chess.turn()==='b'&&!chess.game_over()) {
        busy=true; $('thinkingLabel').textContent='CHELO IS THINKING'; $('turnState').textContent='Thinking…'; makePetMove();
      } else if(chess.game_over()) checkGameEnd();
    } else saveActiveMatch();

    $('newGameBtn').addEventListener('click',()=>{
      if(!finished&&chess.historyMoves().length&&mode==='human'&&!confirm('Start a new match? This unfinished match will not change Chelo’s record.')) return;
      newGame();
    });
    $('undoBtn').addEventListener('click',undoTurn);
    $('flipBtn').addEventListener('click',()=>{flipped=!flipped;renderBoard();});
    $('renameBtn').addEventListener('click',()=>{
      const name=prompt('Give your Chelo a name:',brain.data.petName);
      if(name&&name.trim()) {brain.data.petName=name.trim().slice(0,22);brain.save();updatePetUI();toast('A new name!');}
    });
    $('exportBtn').addEventListener('click',exportChelo);
    $('importBtn').addEventListener('click',()=>$('importFile').click());
    $('importFile').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importChelo(file);event.target.value='';});
    $('claimDrawBtn').addEventListener('click',()=>{
      if(!chess.canClaimDraw()||finished||mode!=='human')return;
      finishMatch('draw','Draw claimed. Chelo keeps the experience from this game.');
    });
    $('promotionDialog').addEventListener('close',()=>{
      const choice=$('promotionDialog').returnValue;
      if(choice&&choice!=='cancel'&&pendingPromotion)playHuman(pendingPromotion.from,pendingPromotion.to,choice);
      pendingPromotion=null;
    });

    if('serviceWorker'in navigator&&location.protocol!=='file:') {
      navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Offline installation is unavailable.',error));
    }
  }

  window.addEventListener('DOMContentLoaded',init);
})();
