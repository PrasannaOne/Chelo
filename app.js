(() => {
  'use strict';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const chess = new ChessCore();
  const brain = new ChesslingBrain();
  const ACTIVE_MATCH_KEY = 'chessling_active_match_v3';
  const LEGACY_MATCH_KEY = 'chessling_active_match_v2';
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
  let practiceTimer = null;
  let practiceRunId = 0;
  let practicePaused = false;
  let practicePausedByHidden = false;
  let practicePendingSearch = null;
  let practiceMoveCount = 0;

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
    try { aiWorker = new Worker('./ai-worker.js'); }
    catch (error) { console.warn('Chessling will use the local fallback search.', error); }
  }

  function requestAIMove() {
    if (!aiWorker) return new Promise(resolve => setTimeout(() => {
      try { resolve({ok:true, ...brain.chooseMove(chess, {timeMs:420,nodeLimit:30000})}); }
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
        try { finish({ok:true, ...brain.chooseMove(chess, {timeMs:420,nodeLimit:30000})}); }
        catch (error) { finish({ok:false,error:error.message}); }
      };
      const errorHandler = () => fallback();
      const timer = setTimeout(fallback, 6000);
      aiWorker.addEventListener('message', handler);
      aiWorker.addEventListener('error', errorHandler, {once:true});
      try {
        aiWorker.postMessage({
          id, fen:chess.fen(), brainData:clone(brain.data),
          timeMs:520, nodeLimit:36000
        });
      } catch { fallback(); }
    });
  }

  function getActiveMatch() {
    for (const key of [ACTIVE_MATCH_KEY, LEGACY_MATCH_KEY]) {
      try {
        const match = JSON.parse(localStorage.getItem(key) || 'null');
        if (match && Array.isArray(match.moves)) return match;
      } catch { /* Ignore a damaged active-game snapshot and try the previous format. */ }
    }
    return null;
  }

  function saveActiveMatch() {
    try {
      localStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify({
        version:2, mode, moves:chess.historyMoves().map(m => m.uci), updatedAt:Date.now()
      }));
      localStorage.removeItem(LEGACY_MATCH_KEY);
    } catch (error) {
      console.warn('Chessling could not save the current match.', error);
      toast('The current match could not be saved on this device.');
    }
  }

  function clearActiveMatch() {
    try { localStorage.removeItem(ACTIVE_MATCH_KEY); localStorage.removeItem(LEGACY_MATCH_KEY); }
    catch { /* Storage may be disabled. */ }
  }

  function restoreMatch(match) {
    chess.load(START_FEN);
    if (!match || !Array.isArray(match.moves)) return false;
    for (const uci of match.moves) {
      if (!chess.move(uci)) { chess.load(START_FEN); return false; }
    }
    mode = match.mode === 'practice' ? 'practice' : 'human';
    practiceMoveCount = mode === 'practice' ? match.moves.length : 0;
    lastMove = chess.historyMoves().at(-1) || null;
    return true;
  }

  function updateSideLabels() {
    const white = mode === 'practice' ? brain.data.petName : 'You';
    const black = brain.data.petName;
    $('whiteName').textContent = white;
    $('blackName').textContent = black;
    $('whiteMode').textContent = mode === 'practice' ? '· White' : '· White';
    $('blackMode').textContent = '· Black';
    $('practiceCard').classList.toggle('active', mode === 'practice');
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
    $('claimDrawBtn').hidden = mode === 'practice' || finished || !chess.canClaimDraw();
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
    $('thinkingLabel').textContent = 'CHESSLING IS THINKING';
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
      $('gameMessage').textContent = search?.error || 'Chessling could not find a legal move.';
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
      $('gameMessage').textContent = `Chessling replied${search.depth?` · depth ${search.depth}`:''}. Your turn.`;
    }
  }

  function finishMatch(outcome,message) {
    finished = true; busy = false; mode = 'human';
    brain.reinforce(outcome,chess); clearActiveMatch();
    $('thinkingLabel').textContent = 'MATCH COMPLETE';
    $('turnState').textContent = outcome==='win'?'Chessling wins':outcome==='loss'?'You win':'Draw';
    $('gameMessage').textContent = message;
    $('learningState').textContent = 'Memory saved';
    $('learningNote').textContent = outcome==='win'
      ? 'The completed game reinforced decisions that led to a win.'
      : outcome==='loss'
        ? 'The loss was reviewed. Its moves and their consequences remain part of its learning.'
        : 'The draw adds a smaller result signal. Individual move feedback still matters.';
    updatePetUI(); updateBrainUI(); updateClaimButton(); updateSideLabels();
    $('undoBtn').disabled = !turnUndoSnapshot;
    updatePracticeControls();
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
    $('learningState').textContent='Learning'; $('gameMessage').textContent='Last turn undone. Chessling’s saved learning was restored too.';
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
    $('eloValue').textContent=data.elo; $('genValue').textContent=data.gen;
    $('recordValue').textContent=`${data.wins} · ${data.losses} · ${data.draws}`;
    $('practiceGamesValue').textContent=data.practiceGames || 0;
    updateSideLabels();
  }

  function updateBrainUI() {
    const data=brain.data, size=brain.size(), kib=size/1024;
    $('memoryCount').textContent=brain.memoryCount();
    $('brainSize').innerHTML=`${(size/1024).toFixed(2)} KB <small>/ 50 KiB</small>`;
    $('budgetFill').style.width=`${Math.min(100,size/51200*100)}%`;
    $('budgetFill').classList.toggle('near-limit',size>46080);
    for(const piece of ['p','n','b','r','q']) {
      const value=brain.materialSignal(piece);
      $('value-'+piece).textContent=`${value>=0?'+':''}${value.toFixed(2)}`;
      $('weight-'+piece).style.width=`${Math.max(3,Math.abs(value)*100)}%`;
      $('weight-'+piece).style.opacity=value===0?'0.28':'1';
    }
    $('modelUpdates').textContent=(data.model?.steps||0).toLocaleString();
    $('replayCount').textContent=(data.replay||[]).length;
    $('policySummary').textContent=`Neural model · ${data.model?.episodes||0} training episodes · ${(data.replay||[]).length} replay memories`;
  }

  function updatePracticeControls() {
    const active=mode==='practice'&&!finished;
    $('startPracticeBtn').disabled=active;
    $('pausePracticeBtn').disabled=!active;
    $('stopPracticeBtn').disabled=!active;
    $('pausePracticeBtn').textContent=practicePaused?'Resume':'Pause';
    $('skipPracticeBtn').disabled=true;
    $('practiceStatus').textContent=active
      ? (practicePaused?'Practice paused. The board is waiting for you.':`Live self-play · ${practiceMoveCount} half-moves · No rating changes`)
      : (mode==='practice'&&finished?'Practice complete. No rating or W/L record was changed.':'Optional self-play. Watch every move as your pet tests its ideas.');
  }

  function clearPracticeTimer() {
    if(practiceTimer!==null) clearTimeout(practiceTimer);
    practiceTimer=null;
  }

  function startPractice() {
    if(mode==='practice'&&!finished) return;
    if(chess.historyMoves().length && !finished && !confirm('Start a practice match? The current unfinished game will be left unranked.')) return;
    practiceRunId++; clearPracticeTimer(); practicePendingSearch=null;
    brain.resetPending();
    chess.load(START_FEN); mode='practice'; finished=false; busy=false;
    selected=null; selectedMoves=[]; lastMove=null; turnUndoSnapshot=null;
    practiceMoveCount=0; practicePaused=false; practicePausedByHidden=false;
    $('undoBtn').disabled=true; $('thinkingLabel').textContent='PRACTICE STARTING';
    $('turnState').textContent='White to move'; $('learningState').textContent='Practising';
    $('gameMessage').textContent='Your Chessling is playing both colours. Every move appears here before the next one begins.';
    $('learningNote').textContent='Practice responses can shape move preferences, but this match cannot award Elo or wins.';
    saveActiveMatch(); renderBoard(); updateMoveList(); updatePetUI(); updateBrainUI(); updateClaimButton(); updatePracticeControls();
    schedulePracticeMove(900);
  }

  function schedulePracticeMove(delay=1100) {
    clearPracticeTimer();
    if(mode!=='practice'||practicePaused||finished) return;
    if(document.hidden) { practicePaused=true; practicePausedByHidden=true; updatePracticeControls(); return; }
    $('thinkingLabel').textContent=chess.turn()==='w'?'WHITE IS THINKING':'BLACK IS THINKING';
    $('turnState').textContent=chess.turn()==='w'?'Chessling · White':'Chessling · Black';
    $('learningState').textContent='Practising';
    practiceTimer=setTimeout(()=>runPracticeMove(practiceRunId),delay);
  }

  async function runPracticeMove(runId) {
    if(mode!=='practice'||practicePaused||finished||runId!==practiceRunId) return;
    if(document.hidden) { practicePaused=true; practicePausedByHidden=true; updatePracticeControls(); return; }
    busy=true;
    $('thinkingLabel').textContent=chess.turn()==='w'?'WHITE IS THINKING':'BLACK IS THINKING';
    $('turnState').textContent='Chessling is considering a move…';
    const search=practicePendingSearch || await requestAIMove();
    practicePendingSearch=null;
    if(mode!=='practice'||runId!==practiceRunId||finished) return;
    if(practicePaused) { practicePendingSearch=search; busy=false; updatePracticeControls(); return; }
    if(document.hidden) {
      practicePendingSearch=search; practicePaused=true; practicePausedByHidden=true; busy=false;
      updatePracticeControls(); $('gameMessage').textContent='Practice paused because this tab is not visible. Return to the board to continue.';
      return;
    }
    if(!search?.ok||!search.move) {
      busy=false; $('gameMessage').textContent=search?.error||'Practice could not find a legal move.';
      practicePaused=true; updatePracticeControls(); return;
    }
    const fenBefore=chess.fen(), mover=chess.turn();
    const move=chess.move(search.move);
    if(!move) {
      busy=false; practicePaused=true; updatePracticeControls();
      $('gameMessage').textContent='A move failed validation. Practice was paused without changing the board.'; return;
    }
    brain.resolveLastPetMove(chess);
    brain.observePetMove(fenBefore,move.uci,{
      piece:move.piece,captured:move.captured,gaveCheck:/[+#]$/.test(move.san),side:mover
    },chess.historyMoves().length,chess);
    lastMove=move; practiceMoveCount++; busy=false;
    saveActiveMatch(); renderBoard(); updateMoveList(); updateBrainUI(); updateClaimButton();
    $('turnState').textContent=mover==='w'?'Chessling played White':'Chessling played Black';
    $('gameMessage').textContent=`${mover==='w'?'White':'Black'} played ${move.san}. The next move will appear on the board.`;
    if(chess.game_over()) { finishPractice(); return; }
    schedulePracticeMove(1100);
  }

  function finishPractice() {
    clearPracticeTimer(); busy=false; finished=true; practicePaused=false;
    const result=chess.result();
    brain.reinforce('practice',chess); clearActiveMatch();
    $('thinkingLabel').textContent='PRACTICE COMPLETE';
    $('turnState').textContent=result==='draw'?'Draw':`${result==='w'?'White':'Black'} wins`;
    $('learningState').textContent='Practice saved';
    $('gameMessage').textContent=`Practice finished. Its move-by-move experience was kept, but Growth Elo and the W · L · D record did not change.`;
    $('learningNote').textContent='Self-play is rehearsal, not a ranked result. The same pet cannot earn rating points by playing itself.';
    updatePetUI(); updateBrainUI(); updateClaimButton(); updatePracticeControls();
  }

  function pausePractice() {
    if(mode!=='practice') return;
    if(practicePaused) {
      practicePaused=false; practicePausedByHidden=false; busy=false;
      updatePracticeControls();
      if(practicePendingSearch) runPracticeMove(practiceRunId); else schedulePracticeMove(250);
    } else {
      practicePaused=true; clearPracticeTimer(); updatePracticeControls();
      $('thinkingLabel').textContent='PRACTICE PAUSED'; $('turnState').textContent='Waiting';
    }
  }

  function stopPractice() {
    if(mode!=='practice') return;
    practiceRunId++; clearPracticeTimer(); practicePendingSearch=null;
    brain.resetPending(); mode='human'; finished=false; busy=false;
    chess.load(START_FEN); selected=null; selectedMoves=[]; lastMove=null; practicePaused=false;
    clearActiveMatch();
    $('thinkingLabel').textContent='YOUR MOVE'; $('turnState').textContent='Your turn';
    $('learningState').textContent='Ready'; $('gameMessage').textContent='Practice stopped. Confirmed move feedback remains saved; no result or rating was added.';
    $('undoBtn').disabled=true; renderBoard(); updateMoveList(); updateClaimButton(); updatePracticeControls(); updateSideLabels();
  }

  function newGame() {
    if(mode==='practice') stopPractice();
    chess.load(START_FEN); brain.resetPending(); clearActiveMatch();
    mode='human'; turnUndoSnapshot=null; selected=null; selectedMoves=[]; lastMove=null;
    busy=false; finished=false; practiceRunId++; clearPracticeTimer(); practicePendingSearch=null;
    $('thinkingLabel').textContent='YOUR MOVE'; $('turnState').textContent='Your turn';
    $('learningState').textContent='Ready'; $('gameMessage').textContent='Choose a piece, then tap a highlighted square.';
    $('learningNote').textContent='Its first memories are being formed.'; $('undoBtn').disabled=true;
    saveActiveMatch(); renderBoard(); updateMoveList(); updateClaimButton(); updatePracticeControls(); updateSideLabels();
  }

  function exportSoul() {
    try {
      const active=mode==='practice'?{mode,moves:chess.historyMoves().map(m=>m.uci)}:getActiveMatch();
      const blob=new Blob([brain.exportSoul(active)],{type:'application/json'});
      const url=URL.createObjectURL(blob), anchor=document.createElement('a');
      anchor.href=url;
      anchor.download=`${(brain.data.petName||'chessling').toLowerCase().replace(/[^a-z0-9]+/g,'_')}_soul.json`;
      anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Chessling Soul exported.');
    } catch(error) { toast(error.message||'Could not export this Soul.'); }
  }

  async function importSoul(file) {
    try {
      const parsed=JSON.parse(await file.text());
      practiceRunId++; clearPracticeTimer(); practicePendingSearch=null;
      const activeMatch=brain.importSoul(parsed);
      const restored=restoreMatch(activeMatch);
      finished=false; busy=false; turnUndoSnapshot=null;
      if(!restored) { brain.resetPending(); newGame(); }
      else {
        saveActiveMatch(); renderBoard(); updateMoveList(); updateClaimButton();
        if(mode==='practice') { practicePaused=false; schedulePracticeMove(500); }
        else if(chess.turn()==='b'&&!chess.game_over()) { busy=true; makePetMove(); }
        else if(chess.game_over()) checkGameEnd();
      }
      updatePetUI(); updateBrainUI(); updatePracticeControls(); toast('Soul restored successfully.');
    } catch(error) { toast(error.message||'Could not import that Soul.'); }
  }

  function init() {
    createAIWorker();
    const activeMatch=getActiveMatch();
    const restored=restoreMatch(activeMatch);
    if(!restored&&brain.data.pending.length) brain.resetPending();
    renderBoard(); updatePetUI(); updateBrainUI(); updateMoveList(); updateClaimButton(); updatePracticeControls();
    if(restored&&chess.historyMoves().length) {
      $('gameMessage').textContent=mode==='practice'?'Your unfinished on-screen practice was restored.':'Your unfinished match was restored.';
      if(mode==='practice'&&!chess.game_over()) schedulePracticeMove(700);
      else if(mode==='human'&&chess.turn()==='b'&&!chess.game_over()) {
        busy=true; $('thinkingLabel').textContent='CHESSLING IS THINKING'; $('turnState').textContent='Thinking…'; makePetMove();
      } else if(chess.game_over()) { if(mode==='practice') finishPractice(); else checkGameEnd(); }
    } else saveActiveMatch();

    $('newGameBtn').addEventListener('click',()=>{
      if(!finished&&chess.historyMoves().length&&mode==='human'&&!confirm('Start a new match? This unfinished match will not change Chessling’s record.')) return;
      newGame();
    });
    $('undoBtn').addEventListener('click',undoTurn);
    $('flipBtn').addEventListener('click',()=>{flipped=!flipped;renderBoard();});
    $('renameBtn').addEventListener('click',()=>{
      const name=prompt('Give your Chessling a name:',brain.data.petName);
      if(name&&name.trim()) {brain.data.petName=name.trim().slice(0,22);brain.save();updatePetUI();toast('A new name!');}
    });
    $('exportBtn').addEventListener('click',exportSoul);
    $('importBtn').addEventListener('click',()=>$('importFile').click());
    $('importFile').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importSoul(file);event.target.value='';});
    $('claimDrawBtn').addEventListener('click',()=>{
      if(!chess.canClaimDraw()||finished||mode!=='human')return;
      finishMatch('draw','Draw claimed. Chessling keeps the experience from this game.');
    });
    $('startPracticeBtn').addEventListener('click',startPractice);
    $('pausePracticeBtn').addEventListener('click',pausePractice);
    $('stopPracticeBtn').addEventListener('click',stopPractice);
    $('promotionDialog').addEventListener('close',()=>{
      const choice=$('promotionDialog').returnValue;
      if(choice&&choice!=='cancel'&&pendingPromotion)playHuman(pendingPromotion.from,pendingPromotion.to,choice);
      pendingPromotion=null;
    });
    document.addEventListener('visibilitychange',()=>{
      if(mode!=='practice'||finished)return;
      if(document.hidden) {
        if(!practicePaused) {practicePaused=true;practicePausedByHidden=true;clearPracticeTimer();updatePracticeControls();}
      } else if(practicePausedByHidden) {
        practicePaused=false;practicePausedByHidden=false;updatePracticeControls();
        if(practicePendingSearch)runPracticeMove(practiceRunId);else schedulePracticeMove(350);
      }
    });
    if('serviceWorker'in navigator&&location.protocol!=='file:') {
      navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Offline installation is unavailable.',error));
    }
  }

  window.addEventListener('DOMContentLoaded',init);
})();
