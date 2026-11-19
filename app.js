(() => {
  const PIECES={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};
  const chess=new ChessCore();
  const brain=new ChesslingBrain();
  let selected=null,selectedMoves=[],flipped=false,busy=false,finished=false,lastMove=null,pendingPromotion=null;
  const $=id=>document.getElementById(id);
  const toast=(message)=>{const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2400);};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function renderBoard(){
    const el=$('chessboard');el.innerHTML='';const board=chess.board();
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const rr=flipped?7-r:r,cc=flipped?7-c:c,rank=8-rr,file='abcdefgh'[cc],square=file+rank,piece=board[rr][cc];
      const cell=document.createElement('button');cell.type='button';cell.className=`square ${(rr+cc)%2===0?'light':'dark'}`;cell.setAttribute('role','gridcell');cell.setAttribute('aria-label',`${square}${piece?' '+piece.color+' '+piece.type:''}`);cell.dataset.square=square;
      if(selected===square)cell.classList.add('selected');if(lastMove&&(lastMove.from===square||lastMove.to===square))cell.classList.add('last-move');
      const legal=selectedMoves.some(m=>m.to===square);if(legal){const dot=document.createElement('span');dot.className='move-dot';cell.appendChild(dot);if(piece)cell.classList.add('has-piece');}
      if(piece){const span=document.createElement('span');span.className=`piece ${piece.color==='w'?'white':'black'}`;span.textContent=PIECES[piece.color+piece.type];cell.appendChild(span);}
      if(cc===0){const coord=document.createElement('span');coord.className='coordinate rank';coord.textContent=rank;cell.appendChild(coord);}if(rr===7){const coord=document.createElement('span');coord.className='coordinate file';coord.textContent=file;cell.appendChild(coord);}
      cell.addEventListener('click',()=>onSquareTap(square));el.appendChild(cell);
    }
  }
  function onSquareTap(square){
    if(busy||finished||chess.turn()!=='w')return;
    const target=selectedMoves.filter(m=>m.to===square);
    if(selected&&target.length){
      if(target.some(m=>m.promotion)){pendingPromotion={from:selected,to:square};$('promotionDialog').showModal();return;}
      playHuman(selected,square);return;
    }
    const piece=chess.get(square);
    if(piece&&piece.color==='w'){selected=square;selectedMoves=chess.moves({square,verbose:true});}
    else{selected=null;selectedMoves=[];}
    renderBoard();
  }
  function playHuman(from,to,promotion='q'){
    const fen=chess.fen(),move=chess.move({from,to,promotion});if(!move)return;
    brain.observeHumanMove(fen,move.san,chess.historyMoves().length);lastMove=move;selected=null;selectedMoves=[];renderBoard();updateMoveList();updateBrainUI();
    if(checkGameEnd())return;
    busy=true;$('thinkingLabel').textContent='CHESSLING IS THINKING';$('turnState').textContent='Thinking…';$('learningState').textContent='Learning';$('gameMessage').textContent='It is weighing its options…';
    setTimeout(makePetMove,180);
  }
  function makePetMove(){
    if(finished)return;const fen=chess.fen(),moveUci=brain.chooseMove(chess);
    if(!moveUci){busy=false;checkGameEnd();return;}
    const move=chess.move(moveUci);if(move){brain.observePetMove(fen,move.san,{piece:move.piece,captured:move.captured},chess.historyMoves().length);lastMove=move;}
    busy=false;renderBoard();updateMoveList();updateBrainUI();
    if(!checkGameEnd()){$('thinkingLabel').textContent='YOUR MOVE';$('turnState').textContent='Your turn';$('learningState').textContent='Learning';$('gameMessage').textContent='Chessling has made its move. Your turn.';}
  }
  function checkGameEnd(){
    if(!chess.game_over())return false;finished=true;busy=false;const result=chess.result();let outcome='draw',message='A draw. Both brains keep the experience.';
    if(result==='b'){outcome='win';message=`${brain.data.petName} wins. Your little monster found checkmate!`;}
    if(result==='w'){outcome='loss';message=`You win! ${brain.data.petName} has a new lesson to remember.`;}
    brain.reinforce(outcome);$('thinkingLabel').textContent='MATCH COMPLETE';$('turnState').textContent=outcome==='win'?'Chessling wins':outcome==='loss'?'You win':'Draw';$('gameMessage').textContent=message;$('learningState').textContent='Memory saved';$('learningNote').textContent=outcome==='win'?'That result strengthened the decisions behind its winning game.':outcome==='loss'?'The loss has been added to its experience. It will reconsider those decisions.':'A drawn game still adds useful experience.';updatePetUI();updateBrainUI();return true;
  }
  function updateMoveList(){const moves=chess.historyMoves(),list=$('moveList');list.innerHTML='';if(!moves.length){list.innerHTML='<li class="empty-moves">Your first move is waiting.</li>';$('moveCount').textContent='0 moves';return;}
    for(let i=0;i<moves.length;i+=2){const li=document.createElement('li');li.innerHTML=`<span class="move-no">${Math.floor(i/2)+1}.</span><span class="white-move">${moves[i]?.san||''}</span><span class="black-move">${moves[i+1]?.san||''}</span>`;list.appendChild(li);}
    $('moveCount').textContent=`${moves.length} ply${moves.length===1?'':'s'}`;list.scrollTop=list.scrollHeight;
  }
  function updatePetUI(){const d=brain.data;let avatar='🐣';if(d.gen>=2&&d.gen<4)avatar='🐥';else if(d.gen>=4&&d.gen<8)avatar='🦉';else if(d.gen>=8)avatar='🐉';$('petAvatar').textContent=avatar;$('petName').textContent=d.petName;$('opponentName').textContent=d.petName;$('petMood').textContent=`${brain.generation()} · ${brain.personality()}`;$('eloValue').textContent=d.elo;$('genValue').textContent=d.gen;$('recordValue').textContent=`${d.wins} · ${d.losses} · ${d.draws}`;}
  function updateBrainUI(){const d=brain.data,size=brain.size(),kb=size/1024;$('memoryCount').textContent=brain.memoryCount();$('brainSize').innerHTML=`${kb.toFixed(1)} KB <small>/ 50 KB</small>`;$('budgetFill').style.width=`${Math.min(100,kb/50*100)}%`;
    for(const p of ['p','n','b','r','q']){const value=d.weights[p]||100;$(`value-${p}`).textContent=(value/100).toFixed(1);$(`weight-${p}`).style.width=`${Math.min(100,value/10)}%`;}
  }
  function newGame(){chess.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');brain.resetPending();selected=null;selectedMoves=[];lastMove=null;busy=false;finished=false;$('thinkingLabel').textContent='YOUR MOVE';$('turnState').textContent='Your turn';$('learningState').textContent='Ready';$('gameMessage').textContent='Choose a piece, then tap a highlighted square.';$('learningNote').textContent='Its first memories are being formed.';renderBoard();updateMoveList();}
  function exportSoul(){const blob=new Blob([brain.exportSoul()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${(brain.data.petName||'chessling').toLowerCase().replace(/[^a-z0-9]+/g,'_')}_soul.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Chessling Soul exported.');}
  async function importSoul(file){try{const text=await file.text();brain.importSoul(JSON.parse(text));newGame();updatePetUI();updateBrainUI();toast('Soul restored successfully.');}catch(e){toast(e.message||'Could not import that Soul file.');}}
  function init(){
    renderBoard();updatePetUI();updateBrainUI();updateMoveList();
    $('newGameBtn').addEventListener('click',()=>{if(!finished&&chess.historyMoves().length&&!confirm('Start a new match? This unfinished match will not change Chessling’s rating.'))return;newGame();});
    $('flipBtn').addEventListener('click',()=>{flipped=!flipped;renderBoard();});
    $('renameBtn').addEventListener('click',()=>{const name=prompt('Give your Chessling a name:',brain.data.petName);if(name&&name.trim()){brain.data.petName=name.trim().slice(0,22);brain.save();updatePetUI();toast('A new name!');}});
    $('exportBtn').addEventListener('click',exportSoul);$('importBtn').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importSoul(file);e.target.value='';});
    $('promotionDialog').addEventListener('close',()=>{const choice=$('promotionDialog').returnValue;if(choice&&choice!=='cancel'&&pendingPromotion){playHuman(pendingPromotion.from,pendingPromotion.to,choice);}pendingPromotion=null;});
    if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  window.addEventListener('DOMContentLoaded',init);
})();
