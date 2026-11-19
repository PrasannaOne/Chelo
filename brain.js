/* Chessling's compact 3-layer learning brain. All learning runs locally. */
(() => {
  const LIMIT = 50 * 1024;
  const VALUES = { p:100, n:110, b:110, r:120, q:130, k:9000 };
  const TYPES = ['p','n','b','r','q'];
  const now = () => Date.now();
  const fenKey = fen => fen.split(' ').slice(0,2).join(' ');
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

  class ChesslingBrain {
    constructor(key='chessling_pet_1') { this.key=key; this.data=this.load(); this.pending=[]; }
    defaults(){return {schema:1,petName:'Chessling',handle:'',trainerName:'',gen:1,elo:100,wins:0,losses:0,draws:0,games:0,weights:{...VALUES},traits:{bold:50,curious:50,patient:50},memory:{},openingReplies:{},lastHumanMove:'',lastHumanPly:0,createdAt:now(),updatedAt:now()};}
    load(){try{const raw=localStorage.getItem(this.key);if(!raw)return this.defaults();const d=JSON.parse(raw);if(!d||d.schema!==1||!d.weights||!d.memory) return this.defaults();return {...this.defaults(),...d,weights:{...VALUES,...d.weights},traits:{bold:50,curious:50,patient:50,...(d.traits||{})}};}catch{return this.defaults();}}
    size(){return bytes(this.data);}
    save(){this.data.updatedAt=now();this.pruneToBudget();try{localStorage.setItem(this.key,JSON.stringify(this.data));}catch(e){this.pruneToBudget(true);try{localStorage.setItem(this.key,JSON.stringify(this.data));}catch{console.warn('Chessling could not persist its brain:',e);}}}
    pruneToBudget(force=false){
      let keys=Object.keys(this.data.memory);
      const getLast=key=>Math.max(0,...Object.values(this.data.memory[key]||{}).map(v=>v.last||0));
      keys.sort((a,b)=>getLast(a)-getLast(b));
      while(keys.length && (force || this.size()>LIMIT-256)){delete this.data.memory[keys.shift()];force=false;}
      const replies=this.data.openingReplies||{};
      const replyKeys=Object.keys(replies).sort((a,b)=>(replies[a].last||0)-(replies[b].last||0));
      while(replyKeys.length && this.size()>LIMIT-256) delete replies[replyKeys.shift()];
      // Keep the non-memory core comfortably below the cap.
      if(this.size()>LIMIT){for(const k of Object.keys(this.data.memory))delete this.data.memory[k];}
    }
    simplifyFen(fen){return fenKey(fen);}
    entry(fen,move){const k=this.simplifyFen(fen);this.data.memory[k] ||= {};this.data.memory[k][move] ||= {score:0,visits:0,mirror:0,last:now(),outcomes:0};return this.data.memory[k][move];}
    observeHumanMove(fen,move,ply=0){const e=this.entry(fen,move);e.visits++;e.mirror++;e.last=now();this.data.lastHumanMove=move;this.data.lastHumanPly=ply;this.save();}
    observePetMove(fen,move,meta={},ply=0){const k=this.simplifyFen(fen),isNew=!this.data.memory[k],e=this.entry(fen,move);e.visits++;e.last=now();this.data.traits ||= {bold:50,curious:50,patient:50};if(meta.captured)this.data.traits.bold=clamp(this.data.traits.bold+1.2,0,100);if(isNew)this.data.traits.curious=clamp(this.data.traits.curious+0.8,0,100);if(e.visits>1)this.data.traits.patient=clamp(this.data.traits.patient+0.35,0,100);this.pending.push({fen:k,move,piece:meta.piece||'p',captured:meta.captured||null});
      if(ply<=12&&this.data.lastHumanMove){const key=`${this.data.lastHumanPly}|${this.data.lastHumanMove}`;const reply=this.data.openingReplies[key]||(this.data.openingReplies[key]={move,count:0,score:0,last:now()});if(reply.move===move){reply.count++;reply.last=now();}else if(reply.count===0){reply.move=move;reply.count=1;reply.last=now();}}
      this.save();}
    evaluate(chess){
      const board=chess.board(), turn=chess.turn();let total=0;
      for(let r=0;r<8;r++)for(let c=0;c<8;c++){const p=board[r][c];if(!p)continue;const v=this.data.weights[p.type]||100;const center=(3.5-Math.abs(3.5-c))+(3.5-Math.abs(3.5-r));const pawnAdvance=p.type==='p'?(p.color==='w'?(6-r):(r-1))*2:0;const positional=(p.type==='k'?0:center*(p.type==='n'||p.type==='b'?3:1)+pawnAdvance);const score=v+positional;total+=(p.color===turn?score:-score);}
      if(chess.inCheck())total-=35;
      return total;
    }
    minimax(chess,depth,alpha,beta){if(depth<=0||chess.game_over())return this.evaluate(chess);const moves=chess.moves();if(!moves.length)return this.evaluate(chess);let best=-Infinity;for(const m of moves){chess.move(m);const score=-this.minimax(chess,depth-1,-beta,-alpha);chess.undo();if(score>best)best=score;if(score>alpha)alpha=score;if(alpha>=beta)break;}return best;}
    chooseMove(chess){
      const moves=chess.moves();if(!moves.length)return null;const fen=this.simplifyFen(chess.fen()), mem=this.data.memory[fen]||{};
      // Opening habits and remembered position outcomes get first consideration.
      let best=null,bestScore=-Infinity;const noise=Math.max(35,190-this.data.elo*0.11);const depth=this.data.elo<500?1:2;
      for(const move of moves){const record=mem[move];chess.move(move);const score=-this.minimax(chess,depth-1,-Infinity,Infinity);chess.undo();const learned=record?(record.score*18+Math.min(18,record.mirror*4)):0;const habitRecord=this.data.lastHumanMove&&chess.historyMoves().length<=12?this.data.openingReplies[`${this.data.lastHumanPly}|${this.data.lastHumanMove}`]:null;const habit=habitRecord&&habitRecord.move===move?Math.min(55,18+habitRecord.count*8+habitRecord.score*5):0;const jitter=(Math.random()-.5)*noise;const total=score+learned+habit+jitter;if(total>bestScore){bestScore=total;best=move;}}
      return best;
    }
    reinforce(result){
      // Result feedback is delayed until the outcome is known; moves are observed continuously.
      const reward=result==='win'?1:result==='loss'?-1:0.15;
      for(const item of this.pending){const e=this.entry(item.fen,item.move);e.score=clamp(e.score+reward*0.35,-8,8);e.outcomes++;e.last=now();}
      // Piece values evolve through small rewarded mutations, not toward hard-coded target values.
      const used={};for(const p of TYPES)used[p]=this.pending.filter(x=>x.piece===p).length;
      for(const p of TYPES){const exposure=Math.min(1,used[p]/4);const mutation=(Math.random()-.5)*2.2;const feedback=reward*exposure*1.4;this.data.weights[p]=Math.round(clamp(this.data.weights[p]+feedback+mutation,65,1000));}
      if(result==='win'){this.data.wins++;this.data.elo+=18;}else if(result==='loss'){this.data.losses++;this.data.elo=Math.max(100,this.data.elo-10);}else{this.data.draws++;this.data.elo+=3;}
      this.data.games++;this.data.gen=1+Math.floor(this.data.games/3);this.pending=[];this.data.lastHumanMove='';this.data.lastHumanPly=0;this.save();
    }
    resetPending(){this.pending=[];}
    memoryCount(){return Object.keys(this.data.memory).length;}
    generation(){const g=this.data.gen;return g<2?'Hatchling':g<4?'Apprentice':g<8?'Tactician':g<15?'Trap Hunter':'Chess Monster';}
    personality(){const t=this.data.traits||{bold:50,curious:50,patient:50};const ranked=Object.entries(t).sort((a,b)=>b[1]-a[1]);if(ranked[0][1]-ranked[1][1]<5)return 'Still finding its style';return ranked[0][0]==='bold'?'Bold and tactical':ranked[0][0]==='curious'?'Curious explorer':'Patient planner';}
    exportSoul(){return JSON.stringify({format:'Chessling Soul',version:1,exportedAt:new Date().toISOString(),pet:this.data},null,2);}
    importSoul(obj){const d=obj?.pet||obj;if(!d||d.schema!==1||!d.weights||!d.memory)throw new Error('This is not a valid Chessling Soul.');const safe={...this.defaults(),...d,weights:{...VALUES,...d.weights},traits:{bold:50,curious:50,patient:50,...(d.traits||{})},memory:{...d.memory},openingReplies:{...(d.openingReplies||{})}};this.data=safe;this.pending=[];this.save();if(this.size()>LIMIT)throw new Error('Soul exceeds the 50 KB brain budget.');}
  }
  window.ChesslingBrain=ChesslingBrain;
  window.CHESSLING_BRAIN_LIMIT=LIMIT;
})();
